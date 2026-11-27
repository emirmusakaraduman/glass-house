// Geometry of public/hero/glasshouse-hero.png (868x561), in the photo's own pixels.
// Every line layer uses viewBox="0 0 868 561", so these coordinates sit exactly on the photo.
// Traced from an edge map of the photo and checked with overlays at 100% and 200%.

export const PHOTO_W = 868;
export const PHOTO_H = 561;

export type Stroke = { d: string; note: string };

/** Ground: driveway lights, lawn line and the right driveway edge. Drawn first. */
export const GROUND: Stroke[] = [
  { d: "M18 404 L240 400", note: "lawn line, left of the entrance" },
  { d: "M752 400 L862 404", note: "lawn line, right of the glass wing" },
  { d: "M117 409 Q60 410 42 420 Q60 431 85 434 Q150 443 225 447 Q300 449 380 446 L457 442", note: "driveway light, left loop and front curve" },
  { d: "M67 452 Q100 446 125 441", note: "driveway light, short left stub" },
  { d: "M745 420 Q800 422 838 432 Q856 440 832 450", note: "driveway light, right of the car" },
  { d: "M630 561 Q730 515 868 474", note: "driveway edge against the lawn, bottom right" },
];

/** House outlines that stay on as the thin neon edge, in draw order. */
export const HOUSE_MAIN: Stroke[][] = [
  // 1. ground slab and entrance steps
  [
    { d: "M240 396 L460 399", note: "ground floor slab, front edge" },
    { d: "M262 403 H372 M270 411 H366 M280 419 H360", note: "entrance steps" },
  ],
  // 2. columns
  [
    { d: "M242 300 V397", note: "ground floor, left jamb" },
    { d: "M426 292 V398", note: "main column, left face" },
    { d: "M451 292 V398", note: "main column, right face" },
  ],
  // 3. upper floor slab (front-left face, then the right face in perspective)
  [
    { d: "M163 273 L465 268 L683 306", note: "upper floor slab, top edge" },
    { d: "M163 304 L465 293 L683 324", note: "upper floor slab, bottom edge" },
  ],
  // 4. roof slab inside the glass shell
  [
    { d: "M253 133 L462 90 L574 115", note: "roof slab, top edge (inside the glass)" },
  ],
  // 5. glass shell outer edges (the box overhangs left and right)
  [
    { d: "M162 201 L209 195 L252 131 L465 64 L684 174", note: "glass shell: left wing top, left slant, roof ridge; apex 465,64" },
    { d: "M465 64 V392", note: "glass shell, front corner" },
    { d: "M576 121 V358", note: "glass shell, middle edge (stops at the car roof)" },
    { d: "M684 174 V354", note: "glass shell, right edge (stops at the car roof)" },
    { d: "M684 211 L752 238 V395", note: "right glass wing, top and outer edge" },
    { d: "M162 201 V291 L252 281", note: "left glass wing, outer edge and bottom" },
    { d: "M253 132 V282", note: "glass shell, front-left edge" },
  ],
];

/** Inner details: fade out when the lines settle. */
export const HOUSE_DETAIL: Stroke[] = [
  { d: "M243 301 H426", note: "ground floor window head" },
  { d: "M283 301 V397 M327 301 V397 M378 301 V397", note: "ground floor mullions, left" },
  { d: "M492 300 V384 M541 302 V369", note: "ground floor mullions, right (stop at the car)" },
  { d: "M290 156 L445 153", note: "upper floor window head" },
  { d: "M287 157 V264 M341 157 V262 M385 157 V260 M431 153 V258", note: "upper floor mullions, left" },
  { d: "M493 160 V262 M542 165 V268 M604 180 V280 M643 190 V292", note: "upper floor mullions, right" },
  { d: "M255 264 L465 254", note: "balcony railing, left" },
  { d: "M466 211 L684 270", note: "balcony railing, right" },
  { d: "M162 259 L252 245", note: "balcony railing, left wing" },
  { d: "M209 195 V288", note: "left glass wing, inner edge" },
  { d: "M684 306 L752 316", note: "right glass wing, floor line" },
];

/** Car outlines (drawn with the house, then lifted onto the car layer). */
export const CAR_LINES: Stroke[] = [
  {
    d: "M458 441 L457 420 Q458 405 467 397 Q500 384 535 374 L552 368 Q580 358 615 354 Q648 350 682 356 Q700 362 706 370 Q725 382 737 397 Q745 408 745 425 L744 437 Q741 445 733 446",
    note: "car body silhouette, nose to tail",
  },
  { d: "M458 441 Q480 452 507 455 L596 461 M640 452 L716 443", note: "car underside and sill" },
  { d: "M548 372 L585 360 L640 355 L650 380 L600 382 Z M655 358 L690 360 L707 372 L700 378 L660 380 Z", note: "window line: windshield and side window" },
];
export const CAR_WHEELS = [
  { cx: 617, cy: 435, rx: 20, ry: 32, note: "front wheel" },
  { cx: 727, cy: 420, rx: 11, ry: 25, note: "rear wheel" },
];
export const CAR_HEADLIGHTS = [
  { cx: 465, cy: 405, rx: 5, ry: 8, note: "left headlight" },
  { cx: 578, cy: 406, rx: 20, ry: 5, note: "right headlight" },
];

/** The car's outline with a few pixels to spare: clip-path for the car layer and the patch under it. */
export const CAR_POLY: [number, number][] = [
  [453, 446], [452, 420], [455, 404], [463, 394], [498, 381], [533, 371], [550, 365], [578, 355], [615, 350],
  [648, 347], [684, 352], [704, 360], [712, 368], [728, 379], [741, 393], [750, 410], [750, 440], [742, 450],
  [700, 453], [642, 458], [632, 470], [617, 472], [600, 469], [590, 466], [507, 460], [470, 455],
];
export const carClipPath = `polygon(${CAR_POLY.map(([x, y]) => `${((x / PHOTO_W) * 100).toFixed(2)}% ${((y / PHOTO_H) * 100).toFixed(2)}%`).join(", ")})`;

/** Glass areas, in the order they light up. Ground floor panels stop at the car. */
export const GLASS_PANELS: string[] = [
  "163,201 209,195 209,288 163,290", // left wing
  "209,195 252,131 253,282 209,288", // left slant face
  "253,131 465,64 465,268 253,281", // upper front face
  "465,64 576,121 576,286 465,268", // upper right face, first bay
  "576,121 684,174 684,306 576,286", // upper right face, second bay
  "684,211 752,238 752,316 684,306", // right wing
  "243,300 426,300 426,397 243,397", // ground floor, left
  "465,291 576,302 576,360 535,374 465,392", // ground floor, right (above the car)
  "576,302 684,318 684,356 640,353 576,360", // ground floor, far right (above the car)
];
export const GLASS_CLIP = GLASS_PANELS;

/** Warm window light, ground floor first. */
export const WINDOW_GLOWS = {
  ground: [
    { x: 244, y: 300, w: 182, h: 96 },
    { x: 466, y: 300, w: 110, h: 60 },
  ],
  upper: [
    { x: 290, y: 157, w: 141, h: 104 },
    { x: 431, y: 160, w: 173, h: 100 },
  ],
};

/** Neon headlight flare positions (photo px). */
export const FLARES = CAR_HEADLIGHTS.map((h) => ({ x: h.cx, y: h.cy }));

/** Where the photo reveal starts: the front door. */
export const DOOR = { x: 400, y: 370 };

/** A soft, bumpy crown outline (trees are drawn fainter than the house). */
function crown(cx: number, cy: number, rx: number, ry: number, bumps: number, phase = 0): string {
  const pts: string[] = [];
  for (let i = 0; i <= bumps; i++) {
    const a = phase + (i / bumps) * Math.PI * 2;
    const x = cx + rx * Math.cos(a);
    const y = cy + ry * Math.sin(a);
    if (i === 0) {
      pts.push(`M${x.toFixed(1)} ${y.toFixed(1)}`);
    } else {
      const am = phase + ((i - 0.5) / bumps) * Math.PI * 2;
      const k = 1.16;
      pts.push(`Q${(cx + rx * k * Math.cos(am)).toFixed(1)} ${(cy + ry * k * Math.sin(am)).toFixed(1)} ${x.toFixed(1)} ${y.toFixed(1)}`);
    }
  }
  return pts.join(" ");
}

export const TREES: Stroke[] = [
  { d: crown(140, 262, 64, 72, 11, 1.9), note: "left tree, crown" },
  { d: "M155 398 L153 336 Q150 318 138 300 M153 344 Q160 322 176 306", note: "left tree, trunk and branches" },
  { d: crown(815, 238, 48, 86, 11, 1.4), note: "right tree, crown" },
  { d: "M848 398 L845 312 M846 340 Q836 322 822 312", note: "right tree, trunk and branch" },
];
