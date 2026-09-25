import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import {
  useApproveAsset,
  useDownloadCandidates,
  useMediaOverview,
  useSceneMedia,
  useSearchMedia,
  useSuggestQueries,
  useUnapproveAsset,
} from "@/hooks/useMedia";
import type { Project } from "@/lib/api";

export const PROVIDER_LABEL: Record<string, string> = { pexels: "Pexels", pixabay: "Pixabay" };

interface SceneSearchState {
  query: string;
  page: number;
  hasMore: boolean;
  warnings: string[];
  suggestions: string[];
}

const hasMedia = (status: string) => status === "approved" || status === "manual";

/** Estado de la revisión de medios (sección 5.6): compartido por la galería y la barra inferior. */
export function useMediaController(project: Project) {
  const { data: overview } = useMediaOverview(project.id);
  const needing = overview?.scenes.filter((s) => s.needs_media) ?? [];
  const [pickedId, setPickedId] = useState<number | null>(null);
  const sceneId =
    (pickedId && overview?.scenes.some((s) => s.scene_id === pickedId) ? pickedId : null) ??
    needing.find((s) => !hasMedia(s.status))?.scene_id ??
    needing[0]?.scene_id ??
    null;
  const { data: scene, isFetching: loadingScene } = useSceneMedia(sceneId);

  const [selection, setSelection] = useState<Record<number, number[]>>({});
  const [searchState, setSearchState] = useState<Record<number, SceneSearchState>>({});
  const [providers, setProviders] = useState<string[]>(["pexels", "pixabay"]);
  const [anyOrientation, setAnyOrientation] = useState(false);

  const searchMutation = useSearchMedia(project.id);
  const suggestMutation = useSuggestQueries();
  const downloadMutation = useDownloadCandidates(project.id);
  const approveMutation = useApproveAsset(project.id);
  const unapproveMutation = useUnapproveAsset(project.id);

  const configured = overview?.configured_providers ?? [];
  const activeProviders = providers.filter((p) => configured.includes(p));
  const editable = overview?.editable ?? false;

  const state: SceneSearchState = (sceneId != null && searchState[sceneId]) || {
    query: scene?.default_query ?? "",
    page: 0,
    hasMore: false,
    warnings: [],
    suggestions: [],
  };
  const patchState = (id: number, patch: Partial<SceneSearchState>) =>
    setSearchState((all) => ({
      ...all,
      [id]: { ...(all[id] ?? { ...state, query: state.query }), ...patch },
    }));

  const selected = (sceneId != null && selection[sceneId]) || [];

  function toggle(candidateId: number) {
    if (sceneId == null) return;
    setSelection((all) => {
      const current = all[sceneId] ?? [];
      return {
        ...all,
        [sceneId]: current.includes(candidateId)
          ? current.filter((id) => id !== candidateId)
          : [...current, candidateId],
      };
    });
  }

  async function search(options: { query?: string; page?: number } = {}) {
    if (sceneId == null || !activeProviders.length) return;
    const query = (options.query ?? state.query).trim();
    const page = options.page ?? 1;
    patchState(sceneId, { query });
    try {
      const result = await searchMutation.mutateAsync({
        sceneId,
        query: query || undefined,
        providers: activeProviders,
        page,
        any_orientation: anyOrientation,
      });
      patchState(sceneId, { page, hasMore: result.has_more, warnings: result.warnings });
    } catch {
      // el aviso lo muestra la caché de mutaciones
    }
  }

  // Al abrir una escena sin candidatos se busca sola (la caché del núcleo evita gastar cuota).
  const autoSearched = useRef(new Set<number>());
  useEffect(() => {
    if (!scene || !editable || !activeProviders.length) return;
    if (scene.scene_id !== sceneId || autoSearched.current.has(scene.scene_id)) return;
    autoSearched.current.add(scene.scene_id);
    if (scene.needs_media && scene.candidates.length === 0 && scene.default_query) void search();
  }, [scene, sceneId, editable, activeProviders.length]); // search se lee fresca en cada render

  async function suggest() {
    if (sceneId == null) return;
    try {
      const { queries } = await suggestMutation.mutateAsync(sceneId);
      patchState(sceneId, { suggestions: queries });
    } catch {
      // el aviso lo muestra la caché de mutaciones
    }
  }

  async function download() {
    if (sceneId == null || !selected.length) return;
    const ids = selected;
    setSelection((all) => ({ ...all, [sceneId]: [] }));
    try {
      await downloadMutation.mutateAsync({ sceneId, ids });
      toast.success(`Descargando ${ids.length} ${ids.length === 1 ? "medio" : "medios"}…`);
    } catch {
      setSelection((all) => ({ ...all, [sceneId]: ids }));
    }
  }

  function retry(candidateId: number) {
    if (sceneId == null) return;
    downloadMutation.mutate({ sceneId, ids: [candidateId] });
  }

  function approve(assetId: number, role: "main" | "alt" = "main") {
    if (sceneId == null) return;
    approveMutation.mutate(
      { sceneId, assetId, role },
      {
        onSuccess: () => {
          if (role !== "main") return;
          // Tras aprobar el principal se pasa a la siguiente escena que aún no tiene medio.
          const next = needing.find((s) => s.scene_id !== sceneId && !hasMedia(s.status));
          if (next) setPickedId(next.scene_id);
        },
      },
    );
  }

  function unapprove(assetId: number) {
    if (sceneId != null) unapproveMutation.mutate({ sceneId, assetId });
  }

  function move(delta: 1 | -1) {
    if (!needing.length) return;
    const index = Math.max(0, needing.findIndex((s) => s.scene_id === sceneId));
    const next = needing[(index + delta + needing.length) % needing.length];
    setPickedId(next.scene_id);
  }

  return {
    overview,
    scene: scene && scene.scene_id === sceneId ? scene : undefined,
    sceneId,
    loadingScene,
    selectScene: setPickedId,
    editable,
    configured,
    providers,
    setProviders,
    anyOrientation,
    setAnyOrientation,
    query: state.query,
    setQuery: (q: string) => sceneId != null && patchState(sceneId, { query: q }),
    warnings: state.warnings,
    hasMore: state.hasMore,
    page: state.page,
    suggestions: state.suggestions,
    searching: searchMutation.isPending,
    suggesting: suggestMutation.isPending,
    search,
    loadMore: () => search({ page: (state.page || 1) + 1 }),
    suggest,
    selected,
    toggle,
    download,
    downloading: downloadMutation.isPending,
    retry,
    approve,
    unapprove,
    approving: approveMutation.isPending,
    next: () => move(1),
    prev: () => move(-1),
  };
}

export type MediaController = ReturnType<typeof useMediaController>;
