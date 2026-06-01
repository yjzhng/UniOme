export type Strand = '+' | '-';

export interface ParsedCoord {
  start: number;
  end: number;
  strand: Strand;
  segments: Array<[number, number]>;
  isJoin: boolean;
}

const RANGE = /^<?(\d+)\.\.>?(\d+)$/;

function parseRange(s: string): [number, number] {
  const m = RANGE.exec(s.trim());
  if (!m) throw new Error(`Bad range: ${s}`);
  return [Number(m[1]), Number(m[2])];
}

function parseSegments(body: string): Array<[number, number]> {
  return body.split(',').map(parseRange);
}

export function parseCoord(raw: string | null | undefined): ParsedCoord | null {
  if (!raw) return null;
  const s = raw.trim();
  if (!s) return null;

  let strand: Strand = '+';
  let body = s;

  const compMatch = /^complement\((.*)\)$/.exec(s);
  if (compMatch) {
    strand = '-';
    body = compMatch[1];
  }

  const joinMatch = /^(?:join|order)\((.*)\)$/.exec(body);
  let segments: Array<[number, number]>;
  let isJoin = false;
  if (joinMatch) {
    isJoin = true;
    segments = parseSegments(joinMatch[1]);
  } else {
    segments = [parseRange(body)];
  }

  const start = Math.min(...segments.map(([a]) => a));
  const end = Math.max(...segments.map(([, b]) => b));
  return { start, end, strand, segments, isJoin };
}
