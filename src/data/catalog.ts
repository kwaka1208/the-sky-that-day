import type { StarRecord } from '../types';
import { NASA_BRIGHT_STARS } from './nasaBrightStars';
import { STARS } from './stars';

const DEG = Math.PI / 180;
const NAMED_STAR_MATCH_RADIUS = 30 / 3600 * DEG;

function colorFromBv(colorIndex: number | null) {
  if (colorIndex === null || colorIndex < .2) return colorIndex !== null && colorIndex < -.1 ? '#c8dcff' : '#dce8ff';
  if (colorIndex < .5) return '#f0f3ff';
  if (colorIndex < .8) return '#fff0cf';
  if (colorIndex < 1.2) return '#ffd09c';
  return '#ffad79';
}

function isNamedStarPosition(raDegrees: number, decDegrees: number) {
  const ra = raDegrees * DEG;
  const dec = decDegrees * DEG;
  return STARS.some((star) => {
    const starDec = star.dec * DEG;
    const cosine = Math.sin(dec) * Math.sin(starDec)
      + Math.cos(dec) * Math.cos(starDec) * Math.cos(ra - star.ra * 15 * DEG);
    return Math.acos(Math.max(-1, Math.min(1, cosine))) <= NAMED_STAR_MATCH_RADIUS;
  });
}

const seenCoordinates = new Set<string>();
const nasaStars: StarRecord[] = [];
for (const [raDegrees, decDegrees, magnitude, bvColor] of NASA_BRIGHT_STARS) {
  const coordinateKey = `${raDegrees.toFixed(6)}:${decDegrees.toFixed(6)}`;
  if (seenCoordinates.has(coordinateKey) || isNamedStarPosition(raDegrees, decDegrees)) continue;
  seenCoordinates.add(coordinateKey);
  nasaStars.push({
    id: `bsc-${nasaStars.length}`,
    name: '',
    ra: raDegrees / 15,
    dec: decDegrees,
    magnitude,
    color: colorFromBv(bvColor),
  });
}

// Named stars cover the bright end; nearby and duplicate BSC5P rows are suppressed.
export const CATALOG_STARS: StarRecord[] = [...STARS, ...nasaStars];
