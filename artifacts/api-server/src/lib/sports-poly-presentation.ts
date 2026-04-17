import {
  enrichPolymarketOfficialPresentation,
  getPolymarketEventPresentationBySourceUrl,
} from "./polymarket-sports";

export interface SportsPolyPresentationInput {
  eventName: string;
  homeTeam: string | null;
  awayTeam: string | null;
  homeTeamId: string | null;
  awayTeamId: string | null;
  homeBadge: string | null;
  awayBadge: string | null;
  leagueLogo: string | null;
  league: string;
  sport: string;
  startsAt: Date;
  sourceUrl: string | null;
}

export interface SportsPolyPresentation {
  homeBadge: string | null;
  awayBadge: string | null;
  leagueLogo: string | null;
  league: string;
  startsAt: Date;
}

function isSyntheticNoonKickoff(value: Date): boolean {
  return value.getUTCHours() === 12 &&
    value.getUTCMinutes() === 0 &&
    value.getUTCSeconds() === 0 &&
    value.getUTCMilliseconds() === 0;
}

export async function enrichSportsPolyPresentation(
  markets: SportsPolyPresentationInput[],
): Promise<SportsPolyPresentation[]> {
  const officialPresentation = await enrichPolymarketOfficialPresentation(
    markets.map((market) => ({
      homeTeam: market.homeTeam,
      awayTeam: market.awayTeam,
      homeTeamId: market.homeTeamId,
      awayTeamId: market.awayTeamId,
      league: market.league,
      sport: market.sport,
      sourceUrl: market.sourceUrl,
      leagueLogo: market.leagueLogo,
    })),
  );

  const sourceUrlsNeedingEventLookup = Array.from(
    new Set(
      markets
        .filter((market, index) =>
          isSyntheticNoonKickoff(market.startsAt) ||
          (!officialPresentation[index]?.leagueLogo && !market.leagueLogo),
        )
        .map((market) => market.sourceUrl)
        .filter((value): value is string => typeof value === "string" && value.length > 0),
    ),
  );

  const officialEvents = new Map<string, { startsAt: Date | null; leagueLogo: string | null }>();
  await Promise.all(
    sourceUrlsNeedingEventLookup.map(async (sourceUrl) => {
      officialEvents.set(sourceUrl, await getPolymarketEventPresentationBySourceUrl(sourceUrl));
    }),
  );

  return markets.map((market, index) => {
    const official = officialPresentation[index] ?? {
      homeBadge: null,
      awayBadge: null,
      leagueLogo: market.leagueLogo,
    };
    const officialEvent = market.sourceUrl ? officialEvents.get(market.sourceUrl) : undefined;

    return {
      homeBadge: official.homeBadge ?? market.homeBadge,
      awayBadge: official.awayBadge ?? market.awayBadge,
      leagueLogo: officialEvent?.leagueLogo ?? official.leagueLogo ?? market.leagueLogo,
      league: market.league,
      startsAt:
        officialEvent?.startsAt && isSyntheticNoonKickoff(market.startsAt)
          ? officialEvent.startsAt
          : market.startsAt,
    };
  });
}
