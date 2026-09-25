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
import { type ImportSource, useImportMedia } from "@/hooks/useManualMedia";
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
  const importMutation = useImportMedia(project.id);
  const [viewerId, setViewerId] = useState<number | null>(null);
  const [hoveredId, setHoveredId] = useState<number | null>(null);
  const [approveWhenReady, setApproveWhenReady] = useState<number[]>([]);

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

  async function download(explicit?: number[]) {
    if (sceneId == null) return;
    const ids = explicit ?? selected;
    if (!ids.length) return;
    setSelection((all) => ({ ...all, [sceneId]: (all[sceneId] ?? []).filter((id) => !ids.includes(id)) }));
    try {
      await downloadMutation.mutateAsync({ sceneId, ids });
      toast.success(`Descargando ${ids.length} ${ids.length === 1 ? "medio" : "medios"}…`);
    } catch {
      setSelection((all) => ({ ...all, [sceneId]: ids }));
    }
  }

  /** «Descargar y aprobar» (vista grande): se aprueba como principal al terminar la descarga. */
  function downloadAndApprove(candidateId: number) {
    setApproveWhenReady((ids) => [...ids, candidateId]);
    void download([candidateId]);
  }

  useEffect(() => {
    if (!scene || !approveWhenReady.length) return;
    for (const id of approveWhenReady) {
      const c = scene.candidates.find((x) => x.id === id);
      if (!c) continue;
      if (c.asset && (c.download_status === "done" || c.download_status === "manual")) {
        setApproveWhenReady((ids) => ids.filter((x) => x !== id));
        approveMutation.mutate({ sceneId: scene.scene_id, assetId: c.asset.id, role: "main" });
      } else if (c.download_status === "failed") {
        setApproveWhenReady((ids) => ids.filter((x) => x !== id));
      }
    }
  }, [scene, approveWhenReady]); // approveMutation.mutate es estable

  async function importMedia(source: ImportSource, candidateId?: number) {
    if (sceneId == null) return;
    const media = await importMutation.mutateAsync({ sceneId, source, candidateId });
    const main = media.approved.find((a) => a.role === "main");
    toast.success(
      candidateId != null
        ? "Archivo asignado al medio que no se pudo descargar"
        : main && media.candidates.at(-1)?.asset?.id === main.asset.id
          ? `Agregado y aprobado en la escena ${media.position}`
          : `Agregado a la escena ${media.position}`,
    );
  }

  function openViewer(candidateId?: number) {
    const candidates = scene?.candidates ?? [];
    const id = candidateId ?? hoveredId ?? selected[0] ?? candidates[0]?.id ?? null;
    if (id != null && candidates.some((c) => c.id === id)) setViewerId(id);
  }

  function moveViewer(delta: 1 | -1) {
    const candidates = scene?.candidates ?? [];
    const index = candidates.findIndex((c) => c.id === viewerId);
    if (index < 0 || !candidates.length) return;
    setViewerId(candidates[(index + delta + candidates.length) % candidates.length].id);
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
    downloadAndApprove,
    downloading: downloadMutation.isPending,
    importMedia,
    importing: importMutation.isPending,
    viewer: scene?.candidates.find((c) => c.id === viewerId) ?? null,
    openViewer,
    closeViewer: () => setViewerId(null),
    viewerNext: () => moveViewer(1),
    viewerPrev: () => moveViewer(-1),
    setHovered: setHoveredId,
    retry,
    approve,
    unapprove,
    approving: approveMutation.isPending,
    next: () => move(1),
    prev: () => move(-1),
  };
}

export type MediaController = ReturnType<typeof useMediaController>;
