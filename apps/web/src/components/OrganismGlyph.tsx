// Minimalist species-morphology glyph for the home-page tiles. Line-art using `currentColor` (so it
// adapts to the light/dark palette flip) with a faint fill. Mapped by taxid — morphology is an
// intrinsic species trait — defaulting to a rod (most prokaryotes). Add a taxid here to give a new
// organism its shape; until then it shows the generic rod.
type Shape = 'rod' | 'cocci-cluster' | 'bacillus' | 'bacillus-stout';

const SHAPE_BY_TAXID: Record<string, Shape> = {
  '83333': 'rod',            // E. coli — motile rod (flagella)
  '93061': 'cocci-cluster',  // S. aureus — cocci in grape-like clusters
  '83332': 'bacillus',       // M. tuberculosis — slender non-motile acid-fast bacilli (loose cord)
  '224308': 'bacillus-stout', // B. subtilis — bacilli like Mtb but shorter and fatter rods
};

// E. coli: a pair of rods with whip-like flagella (motile).
function Rod() {
  return (
    <g>
      <g transform="rotate(-8 32 23)">
        <rect x="23" y="18" width="27" height="11" rx="5.5" className="fill-neutral-200" />
        <path d="M23 21c-6-1 -8 2 -14 0" />
        <path d="M23 25c-7 0 -9 3 -15 1" />
      </g>
      <g transform="rotate(6 28 41)">
        <rect x="9" y="36" width="27" height="11" rx="5.5" className="fill-neutral-200" />
        <path d="M36 39c6-1 8 2 14 0" />
        <path d="M36 43c7 0 9 3 15 1" />
      </g>
    </g>
  );
}

// A cluster of bacilli (rounded rods) lying next to each other at slightly different angles. Each rod is
// [x, y, width, angle°]; `height` controls how fat the rods are (rx = height/2 keeps the ends round).
function Rods({ rods, height }: { rods: Array<[number, number, number, number]>; height: number }) {
  return (
    <g>
      {rods.map(([x, y, w, deg], i) => (
        <rect
          key={i}
          x={x}
          y={y}
          width={w}
          height={height}
          rx={height / 2}
          className="fill-neutral-200"
          transform={`rotate(${deg} ${x + w / 2} ${y + height / 2})`}
        />
      ))}
    </g>
  );
}

// M. tuberculosis: a loose cord of slender, non-motile acid-fast bacilli at slightly different angles.
function Bacillus() {
  return <Rods height={7} rods={[[14, 24, 34, -24], [13, 33, 37, -14], [17, 42, 31, -44]]} />;
}

// B. subtilis: the same bacilli cluster as Mtb but shorter and a touch fatter — rod thickness sits
// between E. coli (11) and Mtb (7).
function BacillusStout() {
  return <Rods height={9} rods={[[19, 19, 26, -22], [15, 31, 28, -12], [21, 42, 24, -30]]} />;
}

// S. aureus: filled cocci in an irregular grape-like cluster.
function CocciCluster() {
  const cells: Array<[number, number]> = [[25, 25], [36, 23], [44, 32], [23, 36], [33, 37], [42, 43], [31, 30]];
  return (
    // Opaque light-grey fill (palette-aware) so each cell occludes the ones behind it — a translucent
    // fill would let the back cells' outlines show through the overlaps.
    <g className="fill-neutral-200">
      {cells.map(([cx, cy], i) => <circle key={i} cx={cx} cy={cy} r={6} />)}
    </g>
  );
}

export function OrganismGlyph({ taxid, className }: { taxid: string; className?: string }) {
  const shape = SHAPE_BY_TAXID[taxid] ?? 'rod';
  return (
    <svg
      viewBox="0 0 64 64"
      className={className}
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      {shape === 'rod' && <Rod />}
      {shape === 'bacillus' && <Bacillus />}
      {shape === 'bacillus-stout' && <BacillusStout />}
      {shape === 'cocci-cluster' && <CocciCluster />}
    </svg>
  );
}
