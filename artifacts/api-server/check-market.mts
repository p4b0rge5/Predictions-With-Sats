import { db } from './src/db';
import { sportMarkets } from './src/schema';

const all = await db.select().from(sportMarkets);
const matches = all.filter(m => 
  m.homeTeam.toLowerCase().includes('argentinos') || 
  m.awayTeam.toLowerCase().includes('huracan')
);

console.log('Total markets:', all.length);
console.log('Matches:', matches.length);
for (const m of matches) {
  console.log(JSON.stringify({
    id: m.id,
    home: m.homeTeam,
    away: m.awayTeam,
    league: m.league,
    sport: m.sport,
    startsAt: m.startsAt,
    status: m.status,
    totalHomeSats: m.totalHomeSats,
    totalDrawSats: m.totalDrawSats,
    totalAwaySats: m.totalAwaySats,
  }, null, 2));
}
