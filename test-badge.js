// Test the badge enrichment logic directly
const logo = 'https://polymarket-upload.s3.us-east-2.amazonaws.com/soccer+ball-bba4025f77.png';

function isGenericBadgeLogo(l) {
  if (!l) return false;
  return /(?:soccer|basketball|football|baseball|hockey)\s*ball/i.test(l) ||
    /\+ball-|[sS]occer\+ball|basketball-[a-f0-9]+\.(png|svg|jpg)/i.test(l);
}

function effectiveTeamLogo(l) {
  if (!l) return null;
  if (isGenericBadgeLogo(l)) return null;
  return l;
}

// Test
console.log('soccer ball is generic:', isGenericBadgeLogo(logo));
console.log('effective logo:', effectiveTeamLogo(logo));

// Now test the full flow: what does ?? produce?
const officialBadge = effectiveTeamLogo(logo) ?? 'GENERATED-SVG-BADGE';
const marketBadge = logo;
const finalBadge = officialBadge ?? marketBadge;

console.log('officialBadge:', officialBadge);
console.log('finalBadge:', finalBadge);
console.log('Expected: GENERATED-SVG-BADGE');
