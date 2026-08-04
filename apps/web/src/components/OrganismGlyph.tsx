// Minimalist species-morphology glyph for the home-page tiles. Line-art using `currentColor` (so it
// adapts to the light/dark palette flip) with a faint fill. Mapped by taxid — morphology is an
// intrinsic species trait — defaulting to a rod (most prokaryotes). Add a taxid here to give a new
// organism its shape; until then it shows the generic rod.
type Shape =
  | 'rod' | 'cocci-cluster' | 'bacillus' | 'bacillus-stout'
  | 'rod-polar' | 'rod-peritrichous' | 'rod-plain' | 'curved-rod'
  | 'strep-short' | 'strep-long' | 'pneumo-lancet' | 'rod-capsule'
  | 'diplo-kidney' | 'enterococcus-pair' | 'enterococcus-chain' | 'rod-spore' | 'coccobacillus';

const SHAPE_BY_TAXID: Record<string, Shape> = {
  '83333': 'rod',             // E. coli — motile rod (peritrichous flagella)
  '93061': 'cocci-cluster',   // S. aureus — cocci in grape-like clusters
  '83332': 'bacillus',        // M. tuberculosis — slender non-motile acid-fast bacilli (loose cord)
  '224308': 'bacillus-stout', // B. subtilis — bacilli like Mtb but shorter and fatter rods
  // ── AMR priority pathogens ────────────────────────────────────────────────
  '208964': 'rod-polar',        // P. aeruginosa — rod, single polar flagellum (monotrichous)
  '99287': 'rod-peritrichous',  // S. Typhimurium — motile enteric rod (peritrichous)
  '220341': 'rod-peritrichous', // S. Typhi — motile enteric rod (peritrichous)
  '716541': 'rod-peritrichous', // E. cloacae — motile enteric rod (peritrichous)
  '198214': 'rod-plain',        // S. flexneri — non-motile enteric rod (no flagella)
  '192222': 'curved-rod',       // C. jejuni — curved/comma rod, polar flagellum
  '208435': 'strep-short',      // S. agalactiae — cocci in chains (GBS)
  '160490': 'strep-long',       // S. pyogenes — cocci in long chains (GAS)
  '171101': 'pneumo-lancet',    // S. pneumoniae — lancet-shaped diplococci
  '272620': 'rod-capsule',      // K. pneumoniae — plump encapsulated non-motile rod
  '242231': 'diplo-kidney',     // N. gonorrhoeae — coffee-bean (kidney) diplococci
  '226185': 'enterococcus-pair',  // E. faecalis — ovoid cocci in pairs / short chains
  '333849': 'enterococcus-chain', // E. faecium — ovoid cocci in short chains
  '272563': 'rod-spore',        // C. difficile — endospore-forming rod (drumstick)
  '400667': 'coccobacillus',    // A. baumannii — coccobacillus (short plump rod, pairs)
  '71421': 'coccobacillus',     // H. influenzae — coccobacillus (small pleomorphic rod)
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

// A single rod (rounded capsule), centred and tilted, used by the flagellated-rod glyphs.
function Body() {
  return <rect x="20" y="26" width="27" height="11" rx="5.5" className="fill-neutral-200" transform="rotate(-6 33 31)" />;
}

// P. aeruginosa: one rod with a single long polar flagellum (monotrichous, motile).
function RodPolar() {
  return (
    <g>
      <Body />
      <path d="M20 32c-5 1 -8 -2 -12 0 -3 1 -4 3 -6 2" />
    </g>
  );
}

// Salmonella / Enterobacter: motile enteric rod with flagella radiating all around (peritrichous).
function RodPeritrichous() {
  return (
    <g>
      <Body />
      <path d="M19 30c-4 -1 -7 -3 -10 -2" />
      <path d="M47 33c4 1 7 3 10 2" />
      <path d="M28 25c-1 -4 -4 -5 -3 -9" />
      <path d="M39 25c1 -4 4 -5 3 -9" />
      <path d="M27 38c-1 4 -4 5 -3 9" />
      <path d="M40 38c1 4 4 5 3 9" />
    </g>
  );
}

// S. flexneri: non-motile enteric rods (no flagella).
function RodPlain() {
  return <Rods height={11} rods={[[22, 19, 26, -10], [16, 35, 26, 8]]} />;
}

// C. jejuni: a curved (comma) rod — a crescent — with a single polar flagellum.
function CurvedRod() {
  return (
    <g>
      <path d="M26 14 A 19 19 0 0 0 31 50 A 46 46 0 0 1 26 14 Z" className="fill-neutral-200" />
      <path d="M31 50c-3 3 -1 6 -4 8 -2 1 -4 1 -5 3" />
    </g>
  );
}

// Streptococcus: a chain of cocci.
function CocciChain({ cells }: { cells: Array<[number, number]> }) {
  return <g className="fill-neutral-200">{cells.map(([cx, cy], i) => <circle key={i} cx={cx} cy={cy} r={6} />)}</g>;
}
function StrepShort() { return <CocciChain cells={[[18, 40], [27, 34], [36, 28], [45, 22]]} />; } // GBS: short diagonal chain
function StrepLong() { return <CocciChain cells={[[13, 39], [23, 35], [32, 33], [41, 35], [51, 39]]} />; } // GAS: longer, curved chain

// S. pneumoniae: lancet-shaped diplococci — a pointed-oval pair, points facing outward.
function PneumoLancet() {
  const leaf = (apexY: number, baseY: number) => {
    const midY = (apexY + baseY) / 2;
    return `M32 ${apexY} C41 ${midY}, 41 ${baseY}, 32 ${baseY} C23 ${baseY}, 23 ${midY}, 32 ${apexY} Z`;
  };
  return (
    <g className="fill-neutral-200" transform="rotate(-18 32 32)">
      <path d={leaf(15, 32)} />
      <path d={leaf(49, 32)} />
    </g>
  );
}

// K. pneumoniae: a plump non-motile rod enclosed in a mucoid capsule (dashed halo).
function RodCapsule() {
  return (
    <g>
      <rect x="14" y="20" width="36" height="24" rx="12" className="fill-none" strokeDasharray="3 3.5" />
      <rect x="22" y="27" width="20" height="12" rx="6" className="fill-neutral-200" />
    </g>
  );
}

// N. gonorrhoeae: coffee-bean diplococci — two cells with flattened facing sides.
function DiploKidney() {
  return (
    <g className="fill-neutral-200">
      <path d="M30 23 A 9 9 0 1 0 30 41 Z" />
      <path d="M34 23 A 9 9 0 1 1 34 41 Z" />
    </g>
  );
}

// Enterococcus: ovoid cocci in a pair / short chain along a diagonal axis.
function Enterococcus({ n }: { n: number }) {
  const cells = Array.from({ length: n }, (_, i) => [26 + i * 8 - (n - 1) * 4, 26 + i * 8 - (n - 1) * 4] as [number, number]);
  return (
    <g className="fill-neutral-200">
      {cells.map(([cx, cy], i) => <ellipse key={i} cx={cx} cy={cy} rx={6} ry={7.5} transform={`rotate(-45 ${cx} ${cy})`} />)}
    </g>
  );
}

// C. difficile: a rod with a terminal endospore (drumstick swelling at one end).
function RodSpore() {
  return (
    <g transform="rotate(-12 32 33)">
      <rect x="15" y="28" width="25" height="10" rx="5" className="fill-neutral-200" />
      <circle cx="41" cy="33" r="7.5" className="fill-neutral-200" />
    </g>
  );
}

// A. baumannii / H. influenzae: coccobacilli — short plump rods, often in pairs; non-motile.
function Coccobacillus() {
  return (
    <g className="fill-neutral-200">
      <rect x="16" y="24" width="17" height="13" rx="6.5" transform="rotate(-8 24.5 30.5)" />
      <rect x="31" y="30" width="17" height="13" rx="6.5" transform="rotate(-8 39.5 36.5)" />
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
      {shape === 'rod-polar' && <RodPolar />}
      {shape === 'rod-peritrichous' && <RodPeritrichous />}
      {shape === 'rod-plain' && <RodPlain />}
      {shape === 'curved-rod' && <CurvedRod />}
      {shape === 'strep-short' && <StrepShort />}
      {shape === 'strep-long' && <StrepLong />}
      {shape === 'pneumo-lancet' && <PneumoLancet />}
      {shape === 'rod-capsule' && <RodCapsule />}
      {shape === 'diplo-kidney' && <DiploKidney />}
      {shape === 'enterococcus-pair' && <Enterococcus n={2} />}
      {shape === 'enterococcus-chain' && <Enterococcus n={3} />}
      {shape === 'rod-spore' && <RodSpore />}
      {shape === 'coccobacillus' && <Coccobacillus />}
    </svg>
  );
}
