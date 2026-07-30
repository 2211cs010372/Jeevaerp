# Jeeva — Hospital Management System

Next.js 15 (App Router) + React 19 + Tailwind CSS v4 + Prisma. One codebase, two faces:

- **Public portal** — `src/app/(public)/**`, `src/components/marketing/**`, themed by
  `src/app/(public)/site-theme.css`. Marketing + patient-facing booking. Smooth scroll (Lenis),
  scroll choreography (GSAP).
- **Staff portals** — `src/app/{reception,doctor,pharmacy,labs,admin}/**`,
  `src/components/portal/**`, themed by `src/app/portal-theme.css`. Deliberately *not* smooth-scrolled:
  a receptionist tabbing through a form needs the scrollbar to behave like an instrument.

Content for the public site lives in `src/lib/data.ts`. Server logic lives in `src/server/services/**`,
validated by `src/server/validators/**`.

## Commands

```bash
npm run dev         # next dev
npm run typecheck   # tsc --noEmit
npm run test        # vitest run
npm run build       # next build
```

## Skill routing

When the user's request matches an available skill, invoke it via the Skill tool. When in doubt, invoke the skill.

Key routing rules:
- Product ideas/brainstorming → invoke /office-hours
- Strategy/scope → invoke /plan-ceo-review
- Architecture → invoke /plan-eng-review
- Design system/plan review → invoke /design-consultation or /plan-design-review
- Full review pipeline → invoke /autoplan
- Bugs/errors → invoke /investigate
- QA/testing site behavior → invoke /qa or /qa-only
- Code review/diff check → invoke /review
- Visual polish → invoke /design-review
- Ship/deploy/PR → invoke /ship or /land-and-deploy
- Save progress → invoke /context-save
- Resume context → invoke /context-restore
- Author a backlog-ready spec/issue → invoke /spec
