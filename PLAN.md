# uniOme — Project Plan

An interactive browser for a prokaryotic gene-annotation database. The user enters through an **overarching genome browser**; clicking any feature navigates to that feature's **entry page**, which displays consolidated annotations organized by the genetic-level hierarchy (DNA / RNA / Protein) appropriate for the feature's type.

The seed CSV at [resources/83333_Ec_DB.csv](resources/83333_Ec_DB.csv) is treated as the **already-reconciled** ground truth (no per-source disagreement UI in v1). v1 reference organism: *E. coli* K-12 MG1655 (NC_000913.3).

---

## 1. UI shape

```
┌──────────────────────────────────────────────────────────┐
│  /                                                       │
│  ┌────────────────────────────────────────────────────┐  │
│  │  Genome browser  (chromosome NC_000913.3)          │  │
│  │  ── ruler ──────────────────────────────────────── │  │
│  │  + strand: ▮▮ ▮ ▮▮▮▮ ▮ ▮▮ ▮ ▮▮▮▮  …                │  │
│  │  − strand: ▮ ▮▮▮ ▮ ▮▮ ▮▮▮▮ ▮ ▮ ▮▮  …                │  │
│  │  (color by type; click → /entry/:id)               │  │
│  └────────────────────────────────────────────────────┘  │
│  search by gene/locus/coord ─────────────────────────    │
└──────────────────────────────────────────────────────────┘

┌──────────────────────────────────────────────────────────┐
│  /entry/:id                                              │
│  ┌────────────────────────────────────────────────────┐  │
│  │  header: gene · type · ids · coord                 │  │
│  ├────────────────────────────────────────────────────┤  │
│  │  General                                           │  │
│  │  DNA level                                         │  │
│  │  RNA level    (hidden if type has no RNA)          │  │
│  │  Protein level (hidden if type has no Protein)    │  │
│  │  Relationships                                     │  │
│  └────────────────────────────────────────────────────┘  │
└──────────────────────────────────────────────────────────┘
```

---

## 2. Type → levels taxonomy

Which sections appear on an entry page depends on the feature's `type`:

| type           | DNA | RNA | Protein |
|----------------|-----|-----|---------|
| CDS            | ✓   | ✓   | ✓       |
| rRNA           | ✓   | ✓   |         |
| tRNA           | ✓   | ✓   |         |
| ncRNA          | ✓   | ✓   |         |
| misc_feature   | ✓   |     |         |

Future taxonomy (out of v1 scope, but the model supports them): regulatory elements (promoter / enhancer / silencer) — DNA only · structural elements (telomere / centromere) — DNA only · transposons — DNA · pseudogenes — DNA · ribozyme / miRNA — DNA + RNA.

---

## 3. Entry-page field schema vs. v1 data availability

The full schema (target) is what was sketched. For v1 we populate only what's derivable from the current CSV; everything else is a placeholder labeled "not yet ingested."

### General
| field | v1 source |
|---|---|
| name | `gene` |
| other names | `locus_tag`, `uniqID` |
| ids | `uniqID`, `GeneID`, `locus_tag`, `UniProtID` |
| function | `product`, `KG_FG`, `KG_FM`, `UP_KW` |
| pathway | `KG_PW`, `UP_PW` |
| essentiality / mutation freq / conservation | placeholder |

### DNA level
| field | v1 source |
|---|---|
| id | `uniqID` |
| locus (coord) | parsed `coord` → `(start, end, strand, segments)` |
| locus_tag | `locus_tag` |
| gene name | `gene` |
| DNA seq / structure / variants / modifications / interactions | placeholder |

### RNA level
| field | v1 source |
|---|---|
| RNA name | `product` (for ncRNA/tRNA/rRNA) or `gene` (for CDS) |
| RNA seq / id / structure / variants / modifications / interactions / reactions | placeholder (secondary structure deferred per user) |

### Protein level
| field | v1 source |
|---|---|
| protein name | `product` |
| id | `UniProtID` |
| protein seq / structure / interactions / reactions / variants / modifications | placeholder |

### Relationships
| field | v1 source |
|---|---|
| shared function | features sharing any `KG_FG` / `KG_FM` / `UP_KW` tag |
| shared pathway | features sharing any `KG_PW` / `UP_PW` tag |
| seq similarity / shared domains / shared operons / shared regulatory elements | placeholder |

---

## 4. Tech stack (v1)

- **Monorepo**: npm workspaces — `apps/web`, `apps/api`, `packages/shared`.
- **Frontend**: React + TypeScript + Vite, react-router, Tailwind CSS. No component library for now (the UI is sparse enough that plain elements + Tailwind is the most "minimal/compact" route).
- **Genome-browser viz**: custom SVG component (not `igv.js`). One chromosome, two strand rows, features as rects, pan/zoom, click → router. Custom keeps it lean and matches the "minimal compact" goal; we can swap to `igv.js` later if needed.
- **Backend**: Fastify (TS).
- **Storage (v1)**: **in-memory store** loaded from the CSV at server startup. ~6k rows fits trivially in RAM; range queries are fast as plain JS. We'll move to DuckDB if data grows or if we add cross-organism support. (Deviation from the earlier plan, made for v1 simplicity.)
- **Shared package**: TS types + `coord` parser (GenBank notation → `{start, end, strand, segments}`).

### Repo layout
```
uniOme/
├── apps/
│   ├── web/        # React + Vite
│   └── api/        # Fastify + in-memory CSV ingest
├── packages/
│   └── shared/     # types + coord parser
├── resources/      # source CSV
└── PLAN.md
```

### Run
- Dev: `npm run dev` → `api` on `:4000`, `web` on `:5173` (Vite proxies `/api`).

---

## 5. API surface (v1)

- `GET /api/chromosome` → `{ id: "NC_000913.3", length: 4641652 }`
- `GET /api/features?from=&to=&strand=&type=` → array of features with parsed coords (used by the genome track).
- `GET /api/features/:id` → full entry record (id matches any of `uniqID`, `locus_tag`, `UniProtID`, `GeneID`, `gene`).
- `GET /api/features/:id/related` → features sharing function/pathway tags with the given entry.
- `GET /api/search?q=` → quick lookup across ids, gene name, product.

---

## 6. v1 build plan (this session)

1. **Scaffold** the pnpm monorepo (`apps/web`, `apps/api`, `packages/shared`).
2. **packages/shared**: `Feature` types + GenBank-`coord` parser with quick tests against the 4 shapes (`start..end`, `complement(...)`, `join(...)`, empty).
3. **apps/api**: ingest the CSV at startup; expose the 5 endpoints above; basic CORS for dev.
4. **apps/web**: two routes — `/` (genome browser) and `/entry/:id` (entry page).
   - Genome browser: SVG with ruler, two strand rows, type-colored feature rects, pan via drag, zoom via scroll/buttons, tooltip on hover, click navigates.
   - Entry page: header + the 5 sections per Section 3, with type-dependent show/hide of RNA/Protein. Placeholder rows shown in muted style for fields not yet ingested.
5. **Smoke test**: `pnpm dev`, open localhost, browse → click → entry → relationships → click related → back to browser.

Out of v1: search-box UX polish, URL-state sharing, exports, faceted filtering, the rich data (sequences, structures, modifications, interactions, secondary structure, regulatory elements).

---

## 7. Open items (deferred, not blocking v1)

- Reintroduce per-source comparison UI if/when the underlying data ships in per-source form.
- Ingest sources for placeholder fields (UniProt features, PDB structures, RegulonDB, etc.) — decide per field when we get there.
- RNA secondary structure module (user flagged for later).
- Additional type taxonomy categories beyond what the CSV currently contains.
