import type { SVGProps } from 'react'

// Small outline icons for the admin sidebar (decorative: the link text carries the name).
const base = (p: SVGProps<SVGSVGElement>) => ({
  width: 18,
  height: 18,
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.6,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
  'aria-hidden': true,
  focusable: false,
  ...p,
})
type P = SVGProps<SVGSVGElement>

export const HomeIcon = (p: P) => (
  <svg {...base(p)}>
    <path d="M4 11l8-6 8 6v8a1 1 0 0 1-1 1h-4v-6H9v6H5a1 1 0 0 1-1-1v-8Z" />
  </svg>
)
export const BoxIcon = (p: P) => (
  <svg {...base(p)}>
    <path d="M4 8l8-4 8 4v8l-8 4-8-4V8Z" />
    <path d="M4 8l8 4 8-4M12 12v8" />
  </svg>
)
export const BagIcon = (p: P) => (
  <svg {...base(p)}>
    <path d="M5 8h14l-1 12H6L5 8Z" />
    <path d="M9 8V6.5a3 3 0 0 1 6 0V8" />
  </svg>
)
export const TagIcon = (p: P) => (
  <svg {...base(p)}>
    <path d="M4 12V5a1 1 0 0 1 1-1h7l8 8-8 8-8-8Z" />
    <circle cx="8.5" cy="8.5" r="1.3" />
  </svg>
)
export const ImageIcon = (p: P) => (
  <svg {...base(p)}>
    <rect x="4" y="5" width="16" height="14" rx="2" />
    <circle cx="9" cy="10" r="1.5" />
    <path d="m5 17 5-4 4 3 2-2 3 3" />
  </svg>
)
export const ScissorsIcon = (p: P) => (
  <svg {...base(p)}>
    <circle cx="6" cy="7" r="2.5" />
    <circle cx="6" cy="17" r="2.5" />
    <path d="M8 8.5 20 17M8 15.5 20 7" />
  </svg>
)
export const StarIcon = (p: P) => (
  <svg {...base(p)}>
    <path d="m12 4 2.4 5 5.6.7-4.1 3.8 1.1 5.5L12 16.3 7 19l1.1-5.5L4 9.7 9.6 9 12 4Z" />
  </svg>
)
export const UsersIcon = (p: P) => (
  <svg {...base(p)}>
    <circle cx="9" cy="8" r="3" />
    <path d="M3.5 19a5.5 5.5 0 0 1 11 0M16 5.5a3 3 0 0 1 0 5.5M18 14a5 5 0 0 1 2.5 5" />
  </svg>
)
export const ChatIcon = (p: P) => (
  <svg {...base(p)}>
    <path d="M4 5h16v11H9l-5 4V5Z" />
  </svg>
)
export const ListIcon = (p: P) => (
  <svg {...base(p)}>
    <path d="M8 6h12M8 12h12M8 18h12M4 6h.01M4 12h.01M4 18h.01" />
  </svg>
)
export const SlidersIcon = (p: P) => (
  <svg {...base(p)}>
    <path d="M4 7h10M18 7h2M4 17h2M10 17h10" />
    <circle cx="16" cy="7" r="2" />
    <circle cx="8" cy="17" r="2" />
  </svg>
)
export const ArrowUpRightIcon = (p: P) => (
  <svg {...base({ width: 14, height: 14, ...p })}>
    <path d="M7 17 17 7M9 7h8v8" />
  </svg>
)
export const ChevronRightIcon = (p: P) => (
  <svg {...base({ width: 16, height: 16, ...p })}>
    <path d="m9 6 6 6-6 6" />
  </svg>
)
export const PlusIcon = (p: P) => (
  <svg {...base({ width: 16, height: 16, ...p })}>
    <path d="M12 5v14M5 12h14" />
  </svg>
)
