# Design System: Exam-Killer

## 1. Visual Theme & Atmosphere
A restrained, editorial-premium interface with precise asymmetrical whitespace and confident black-pill geometry. The atmosphere is clinical yet warm — like a well-lit studio desk with printed exam papers. Density is balanced (5/10) — generous whitespace without feeling empty. Variance is moderate-asymmetric (6/10) — consistent component vocabulary but varied layout rhythms. Motion is fluid and responsive with spring-like ease-out curves.

## 2. Color Palette & Roles
- **Off-Black Ink** (#18181B) — Primary text, brand elements, primary CTAs, active states. Replaces pure black (#000000 is banned)
- **Pressed Ink** (#0C0C0F) — Pressed/active state for black pills, one step darker than ink
- **Canvas Gray** (#F5F5F7) — Page background, provides subtle separation from card surfaces
- **Soft Surface** (#F0F0F2) — Secondary backgrounds, input field resting state, segmented control track
- **Pure Surface** (#FFFFFF) — Cards, modals, elevated containers, active tab state
- **Hairline Border** (#E8E8EC) — 1px structural lines, card borders, dividers
- **Strong Hairline** (#D4D4D8) — Emphasized borders, hover state borders
- **Body Text** (#3F3F46) — Default paragraph text, relaxed reading contrast
- **Muted Text** (#52525B) — Secondary text, metadata, labels
- **Subtle Text** (#8A8A94) — Captions, counts, lowest-emphasis text
- **Success Green** (#10B981) — Status indicators, completion states
- **Danger Red** (#EF4444) — Destructive actions, error states
- **Focus Ring** (rgba(24,24,27,0.08)) — Subtle black halo for keyboard focus

## 3. Typography Rules
- **UI & Body:** Noto Sans SC — Clean humanist sans-serif with excellent CJK coverage. Weights 400–700
- **Code & Mono:** JetBrains Mono — Modern coding font, loaded at weight 400
- **Banned:** Inter (overused in premium contexts). Generic serifs (Times, Georgia, Garamond). No system font fallbacks for primary stacks
- **Scale:** h1=1.5rem/700, h2=1.25rem/700, h3=1.125rem/600. Tight letter-spacing (-0.022em) for CJK display
- **Body:** 0.9375rem (15px), line-height 1.6, letter-spacing -0.011em, max-width ~65ch

## 4. Component Stylings
* **Buttons:** Full pill geometry (border-radius: 9999px). Primary: filled Off-Black with subtle shadow hover elevation. Secondary: ghost with thin hairline border. All buttons have -1px translateY on hover, scale(0.97) on active/press. No outer glows. No custom cursors.
* **Cards:** Generously rounded (14px). Thin hairline border (1px #E8E8EC). Subtle ambient shadow (0 1px 2px rgba(0,0,0,0.04)). Hover elevates shadow and slightly darkens border. Used only where elevation serves content hierarchy.
* **Inputs:** Default resting state: soft surface background, transparent border. On focus: white background, Off-Black border, subtle black glow halo. Full pill geometry. Label stacked above, helper text optional below.
* **Tabs:** Segmented pill control — soft gray track, active tab lifts white with subtle shadow. Tabs spaced generously (6px gap, 4px padding, 8px 24px per tab).
* **Tags/Chips:** Outlined pills by default (white bg + hairline border). Active state fills solid Off-Black with white text. Smooth background transition.
* **Loaders:** Skeleton shimmer using gradient sweep animation matching exact layout dimensions. No circular spinners.
* **Empty States:** Composed, centered compositions with softened icon (15% opacity) and muted guidance text. 64px vertical padding for breathing room.
* **Toasts:** Floating pill with elevated shadow (--shadow-lg). Slides in from top with ease-out curve. Semantic color fill (green for success, red for error).

## 5. Layout Principles
- CSS Grid and Flexbox used appropriately — no calc() percentage hacks
- App wrapper constrained to 960px max-width, centered, with 40px vertical padding
- Multi-column layouts use Grid with explicit 1fr columns, collapsing to single column below 768px
- No absolute-positioned content stacking — every element occupies its own spatial zone
- Course list uses individual elevated card rows with 2px rounded corners and hover lift interaction
- Responsive: all multi-column layouts collapse to single column on mobile. Touch targets minimum 44px

## 6. Motion & Interaction
- Easing: cubic-bezier(0.16, 1, 0.3, 1) — a premium ease-out curve, approaching spring physics
- Page transitions: 250ms fade-in with 4px upward slide
- Hover feedback: translateY(-1px) lift + shadow depth increase (cards, buttons, list items)
- Active feedback: scale(0.97) compress + shadow removal (buttons, tabs, tags)
- Focus indicators: subtle black halo (--focus-ring) on keyboard focus only
- Hardware-accelerated: transitions use transform and opacity only — never top, left, width, or height
- Motion respect: @media (prefers-reduced-motion) reduces all animations to 0.01ms

## 7. Anti-Patterns (Banned)
- Pure black (#000000) is strictly banned — use Off-Black (#18181B) instead
- No emojis in the interface
- No neon/outer glow shadows on buttons or cards
- No oversaturated accent colors — single accent is Off-Black
- No gradient text on any element
- No glassmorphism as default pattern (topbar uses subtle blur, not glass card)
- No 3-column equal card layout grids
- No "SaaS template" patterns — hero-metric blocks with big numbers, gradient bars
- No AI copywriting clichés ("Elevate", "Seamless", "Next-Gen", "Unleash")
- No bouncing scroll arrows or "Scroll to explore" prompts
- No overlapping text or absolute-positioned content stacking
