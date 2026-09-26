import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import {
  mediaKeys,
  useApproveAsset,
  useDownloadCandidates,
  useDownloadSelected,
  useMediaOverview,
  useSceneMedia,
  useSearchMedia,
  useSelectCandidate,
  useSuggestQueries,
  useUnapproveAsset,
} from "@/hooks/useMedia";
import { type ImportSource, useImportMedia, useVideoFromUrl } from "@/hooks/useManualMedia";
import { useProjectJob } from "@/hooks/useProjectJob";
import { isVideoSite } from "./dropUtils";
import type { Project } from "@/lib/api";

export const PROVIDER_LABEL: Record<string, string> = {
  pexels: "Pexels",
  pixabay: "Pixabay",
  unsplash: "Unsplash",
  openverse: "Openverse",
  wikimedia: "Wikimedia",
  searxng: "Web (SearXNG)",
  manual: "Manual",
};

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

  const [searchState, setSearchState] = useState<Record<number, SceneSearchState>>({});
  // Fuentes elegidas por escena; sin elección, las de su tipo (sección 5.5).
  const [providersByScene, setProvidersByScene] = useState<Record<number, string[]>>({});
  const [anyOrientation, setAnyOrientation] = useState(false);

  const searchMutation = useSearchMedia(project.id);
  const suggestMutation = useSuggestQueries();
  const downloadMutation = useDownloadCandidates(project.id);
  const selectMutation = useSelectCandidate(project.id);
  const downloadSelectedMutation = useDownloadSelected(project.id);
  const queryClient = useQueryClient();
  // «Descargar y aprobar»: todas las escenas a la vez; al terminar se refresca todo.
  const downloadAll = useProjectJob(
    project.id,
    "download_selected",
    () => downloadSelectedMutation.mutateAsync(),
    (job) => {
      void queryClient.invalidateQueries({ queryKey: mediaKeys.overview(project.id) });
      void queryClient.invalidateQueries({ queryKey: ["scene-media"] });
      void queryClient.invalidateQueries({ queryKey: ["project", project.id] });
      const r = (job.result ?? {}) as { downloaded?: number; failed?: number; approved?: number };
      if (r.failed) {
        toast.warning(`${r.approved ?? 0} escenas con medio · ${r.failed} descargas fallaron`, {
          description: "Siguen elegidas: reinténtalo o arrastra el archivo a la escena.",
        });
      } else {
        toast.success(`Listo: ${r.approved ?? 0} escenas quedaron con medio`);
      }
    },
  );
  const approveMutation = useApproveAsset(project.id);
  const unapproveMutation = useUnapproveAsset(project.id);
  const importMutation = useImportMedia(project.id);
  const videoMutation = useVideoFromUrl();
  const [videoDialogUrl, setVideoDialogUrl] = useState<string | null>(null);
  const [viewerId, setViewerId] = useState<number | null>(null);
  const [hoveredId, setHoveredId] = useState<number | null>(null);
  const [approveWhenReady, setApproveWhenReady] = useState<number[]>([]);

  const configured = overview?.configured_providers ?? [];
  const available = scene?.available_providers ?? [];
  const providers = (sceneId != null && providersByScene[sceneId]) || scene?.default_providers || [];
  const activeProviders = providers.filter((p) => available.includes(p));
  const setProviders = (list: string[]) =>
    sceneId != null && setProvidersByScene((all) => ({ ...all, [sceneId]: list }));
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

  // Elegidos por descargar de la escena abierta, en el orden en que se eligieron (se guardan en
  // el núcleo: cerrar la app no los pierde).
  const selected = (scene?.scene_id === sceneId ? scene.candidates : [])
    .filter((c) => c.selected && (c.download_status === "none" || c.download_status === "failed"))
    .sort((a, b) => (a.selection_order ?? 0) - (b.selection_order ?? 0))
    .map((c) => c.id);

  function toggle(candidateId: number) {
    if (sceneId == null) return;
    selectMutation.mutate({ sceneId, candidateId, selected: !selected.includes(candidateId) });
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

  /** Descarga candidatos concretos de la escena abierta (p. ej. desde la vista grande). */
  async function download(ids: number[]) {
    if (sceneId == null || !ids.length) return;
    try {
      await downloadMutation.mutateAsync({ sceneId, ids });
      toast.success(`Descargando ${ids.length} ${ids.length === 1 ? "medio" : "medios"}…`);
    } catch {
      // el aviso lo muestra la caché de mutaciones
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
    // Un enlace de YouTube o redes se baja con yt-dlp: se pregunta si solo un fragmento.
    if (source.kind === "url" && isVideoSite(source.url)) {
      setVideoDialogUrl(source.url);
      return;
    }
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

  async function downloadVideo(url: string, startS: number | null, endS: number | null) {
    if (sceneId == null) return;
    await videoMutation.mutateAsync({ sceneId, url, startS, endS });
    setVideoDialogUrl(null);
    toast.success("Descargando el video…", { description: "Aparecerá en la escena al terminar." });
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
    selectedPending: overview?.selected_pending ?? 0,
    downloadAll: downloadAll.start,
    downloadingAll: downloadAll.running,
    downloadAllJob: downloadAll.job,
    importMedia,
    importing: importMutation.isPending,
    available,
    videoDialogUrl,
    openVideoDialog: (url = "") => setVideoDialogUrl(url),
    closeVideoDialog: () => setVideoDialogUrl(null),
    downloadVideo,
    downloadingVideo: videoMutation.isPending,
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
