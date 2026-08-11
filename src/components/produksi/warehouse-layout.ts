// The confirmed 42-slot Ice Stock Cold Storage denah — one physical room,
// 3 zones (Selatan/Tengah/Utara), each zone made of 2-3 groups. Confirmed
// interactively with the user via the brainstorming visual companion (see
// .superpowers/brainstorm/700-1786449270/content/denah-v2.html) — every
// code, row order, and divider label here is taken directly from that
// confirmed layout, not re-derived.

export interface WarehouseGrup {
  id: string;
  columns: 2 | 3;
  rows: string[][];
  /** Divider label shown after this grup, inside its own zone. Omitted for
   * the last grup of a zone whose only "next" divider is the cross-zone
   * "Jalan" strip a parent component renders structurally between zones. */
  dividerAfter?: string;
}

export interface WarehouseZone {
  id: "S" | "T" | "U";
  label: string;
  grup: WarehouseGrup[];
  /** Only the Utara zone has the room's single sliding door at its end. */
  showPintuGeser: boolean;
}

export const WAREHOUSE_ZONES: WarehouseZone[] = [
  {
    id: "S",
    label: "Selatan",
    showPintuGeser: false,
    grup: [
      {
        id: "S1",
        columns: 2,
        dividerAfter: "Jalan",
        rows: [
          ["S1F", "S1C"],
          ["S1E", "S1B"],
          ["S1D", "S1A"],
        ],
      },
      {
        id: "S2",
        columns: 2,
        rows: [
          ["S2D", "S2A"],
          ["S2E", "S2B"],
          ["S2F", "S2C"],
        ],
      },
    ],
  },
  {
    id: "T",
    label: "Tengah",
    showPintuGeser: false,
    grup: [
      {
        id: "T1",
        columns: 3,
        dividerAfter: "Jalan",
        rows: [
          ["T1I", "T1F", "T1C"],
          ["T1H", "T1E", "T1B"],
          ["T1G", "T1D", "T1A"],
        ],
      },
      {
        id: "T2",
        columns: 3,
        rows: [
          ["T2G", "T2D", "T2A"],
          ["T2H", "T2E", "T2B"],
          ["T2I", "T2F", "T2C"],
        ],
      },
    ],
  },
  {
    id: "U",
    label: "Utara",
    showPintuGeser: true,
    grup: [
      {
        id: "U1",
        columns: 2,
        dividerAfter: "Jalan & Jendela 1",
        rows: [
          ["U1D", "U1B"],
          ["U1C", "U1A"],
        ],
      },
      {
        id: "U2",
        columns: 2,
        dividerAfter: "Jalan & Jendela 2",
        rows: [
          ["U2C", "U2A"],
          ["U2D", "U2B"],
        ],
      },
      {
        id: "U3",
        columns: 2,
        dividerAfter: "Jalan & Jendela 3",
        rows: [
          ["U3C", "U3A"],
          ["U3D", "U3B"],
        ],
      },
    ],
  },
];
