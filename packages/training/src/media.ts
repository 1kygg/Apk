import type { MovementPattern } from "./types";

// Original schematic artwork, dedicated to the public domain. These diagrams
// identify movement families; the written instructions describe execution.
const poses: Record<MovementPattern, string> = {
  squat: '<path d="M86 55 L96 81 L75 99 L55 99 M96 81 L114 100 L130 100 M86 62 L65 75 M86 62 L108 64"/>',
  hinge: '<path d="M79 53 L101 71 L79 93 L61 104 M79 93 L97 110 M99 71 L118 89 M98 70 L112 61"/>',
  push: '<path d="M55 82 L110 69 L136 87 M67 80 L67 106 M110 69 L116 103 M55 82 L35 98"/>',
  pull: '<path d="M90 51 L90 88 L70 111 M90 88 L109 111 M90 65 L65 55 L65 33 M90 65 L115 55 L115 33"/><path d="M48 29 H132"/>',
  shoulders: '<path d="M90 53 L90 87 L72 110 M90 87 L108 110 M90 65 L65 48 L65 29 M90 65 L115 48 L115 29"/>',
  core: '<path d="M44 83 L112 75 L137 96 M58 81 L61 106 M111 76 L119 104"/>',
  calves: '<path d="M89 53 L89 87 L79 108 L67 108 M89 87 L106 105 L118 105 M89 65 L65 79 M89 65 L113 79"/>',
  locomotion: '<path d="M90 53 L84 79 L62 97 M84 79 L109 90 L118 109 M87 63 L65 55 M87 63 L108 72"/>',
  sport: '<path d="M90 53 L84 79 L61 99 M84 79 L106 93 M87 63 L66 51 M87 63 L111 49"/><circle cx="124" cy="105" r="11"/>',
  mobility: '<path d="M90 53 L90 88 L64 109 M90 88 L117 109 M90 66 L57 64 M90 66 L123 64"/>'
};
export function originalMovementSvg(pattern: MovementPattern): string {
  return '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 180 140" role="img" aria-label="Ilustração esquemática do movimento"><rect width="180" height="140" rx="12" fill="#101412"/><g fill="none" stroke="#92b89f" stroke-width="5" stroke-linecap="round" stroke-linejoin="round"><circle cx="90" cy="36" r="10"/>' + poses[pattern] + '</g><path d="M25 119 H155" stroke="#617568" stroke-width="2"/></svg>';
}
