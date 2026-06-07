type EpisodeLike = { id: string; name: string; order: number };

/** Projects an episode row down to the `EpisodeSummaryDto` shape. */
export function toEpisodeSummary(episode: EpisodeLike): EpisodeSummary {
  return { id: episode.id, name: episode.name, order: episode.order };
}

export type EpisodeSummary = { id: string; name: string; order: number };
