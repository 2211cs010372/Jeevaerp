import path from "node:path";
import { PrismaClient, type Role } from "@prisma/client";
import bcrypt from "bcryptjs";

/**
 * THE DEVELOPERS' SUPERUSER ACCOUNTS.
 *
 * Creates (or resets) one login per person who maintains this system, so that
 * development, debugging and data fixes are not done under Mallesh's, Suresh's
 * or Arjun's name. That is the whole point of it: the audit log records
 * `actorUserId`, so every row a developer writes while poking at a live problem
 * is otherwise indistinguishable from a decision a real administrator made
 * about a real patient's money. One login per developer, not one shared one,
 * for the same reason - "the dev account did it" names nobody.
 *
 * SUPERUSER, not ADMIN. The two clear the same doors: `requireRole` treats
 * SUPERUSER as a wildcard over every role gate (see src/lib/auth/guard.ts), and
 * SUBDOMAIN_ALLOWED_ROLES puts it on every portal. What differs is that a
 * developer is not a member of staff - no shift, no department, no salary line -
 * so SUPERUSER is absent from HR's roster, from the headcount on the admin
 * overview, and from the roles the HR screen can assign. As ADMIN these accounts
 * sat in the staff list as two employees nobody hired and nobody could remove.
 *
 * THE PASSWORDS ARE IN THIS FILE, at the owner's instruction, the same way the
 * named-admin seed next door holds three. Worth naming plainly: anyone who can
 * read this repository can sign in as a developer, and these accounts clear
 * every gate in the building. Rotate without editing source by setting
 * DEV_PASSWORD_<KEY>, which overrides the value below:
 *
 *   PowerShell:  $env:DEV_PASSWORD_RUTHWIK='...'; npm run seed:dev
 *   bash:        DEV_PASSWORD_RUTHWIK='...' npm run seed:dev
 *
 * Idempotent - safe to run repeatedly. Every run resets each password to
 * whatever is in force, which is also how you rotate one.
 */

// Next.js reads .env for you; a plain tsx script does not. Same approach as
// scripts/backup.ts - built into Node 22, no dependency. A real environment
// (CI, a container) passes the variables directly and has no file to read.
try {
  process.loadEnvFile(path.join(process.cwd(), ".env"));
} catch {
  /* no .env: the variables are expected to come from the environment itself */
}

const prisma = new PrismaClient();

type Dev = {
  /** Suffix of this developer's override variable: DEV_PASSWORD_<KEY>. */
  key: string;
  username: string;
  name: string;
  /** User.phone is unique and required; these sit in the 90000009xx block,
   *  clear of the named admins on 90000001xx. */
  phone: string;
  password: string;
};

/** Who maintains this system. */
const DEVS: Dev[] = [
  { key: "VINITH",  username: "vinithdba@jeeva.com", name: "Vinith",  phone: "9000000901", password: "@Vinithdba"  },
  { key: "RUTHWIK", username: "ruthwik@jeeva.com",   name: "Ruthwik", phone: "9000000902", password: "@Ruthwik162" },
];

/**
 * Long enough to be worth the bcrypt cost. These accounts reach every portal,
 * so the floor is deliberate - but it is a floor on a hash at cost 12 behind a
 * rate-limited login (see the LoginAttempt table), not the only thing standing
 * between a stranger and the ward.
 */
const MIN_LENGTH = 10;

/**
 * Roles this seed is willing to overwrite.
 *
 * SUPERUSER is the steady state. ADMIN is here because these two accounts were
 * first seeded as ADMIN, before the role existed, and re-running this script is
 * how they are converted; the conversion is announced rather than done quietly.
 * Every other role is refused, so a hand-edit of the roster above cannot turn a
 * receptionist - or the proprietor - into a developer by accident.
 */
const CONVERTIBLE: string[] = ["SUPERUSER", "ADMIN"];

function die(msg: string, hint?: string): never {
  console.error(`\n  seed:dev failed: ${msg}`);
  if (hint) console.error(`  ${hint}`);
  console.error("");
  process.exit(1);
}

function passwordFor(dev: Dev): string {
  return process.env[`DEV_PASSWORD_${dev.key}`] || dev.password;
}

async function main() {
  const roster = DEVS.map((dev) => ({
    dev,
    username: dev.username.toLowerCase(),
    password: passwordFor(dev),
  }));

  // Everything is checked before anything is written. A roster that fails
  // halfway leaves one developer created and the other not, on a database with
  // no staging copy to rehearse the cleanup on.
  for (const { dev, password } of roster) {
    if (password.length < MIN_LENGTH) {
      die(
        `${dev.name}'s password is ${password.length} characters; ${MIN_LENGTH} is the minimum.`,
        "This login clears every portal in the hospital - give it a real password.",
      );
    }
  }

  // Two developers sharing a handle or a phone number is a typo in the roster
  // above, and it would surface as the second upsert quietly overwriting the
  // first rather than as an error.
  for (const field of ["username", "phone"] as const) {
    const seen = new Map<string, string>();
    for (const { dev, username } of roster) {
      const value = field === "username" ? username : dev.phone;
      const owner = seen.get(value);
      if (owner) die(`${dev.name} and ${owner} share the same ${field} (${value}).`);
      seen.set(value, dev.name);
    }
  }

  const existingRole = new Map<string, string>();

  for (const { dev, username } of roster) {
    // A phone collision would surface as an opaque unique-constraint error from
    // the upsert's create branch, on a column nobody was thinking about.
    const clash = await prisma.user.findFirst({
      where: { phone: dev.phone, username: { not: username } },
      select: { name: true, username: true },
    });
    if (clash) {
      die(
        `phone ${dev.phone} already belongs to ${clash.name} (${clash.username}).`,
        `Give ${dev.name} a number nobody on staff is using.`,
      );
    }

    const existing = await prisma.user.findUnique({
      where: { username },
      select: { role: true },
    });
    if (existing) {
      if (!CONVERTIBLE.includes(existing.role)) {
        die(
          `"${username}" already exists and is a ${existing.role}.`,
          "Fix the roster rather than promoting a staff account to SUPERUSER.",
        );
      }
      existingRole.set(username, existing.role);
    }
  }

  console.log("");
  for (const { dev, username, password } of roster) {
    const passwordHash = await bcrypt.hash(password, 12);
    const was = existingRole.get(username);

    await prisma.user.upsert({
      where: { username },
      update: { name: dev.name, email: username, role: "SUPERUSER" as Role, isActive: true, passwordHash },
      create: {
        username,
        phone: dev.phone,
        email: username,
        name: dev.name,
        role: "SUPERUSER" as Role,
        passwordHash,
      },
    });

    const what = !was
      ? "created"
      : was === "ADMIN"
        ? "converted ADMIN -> SUPERUSER for"
        : "password reset for";
    console.log(`  ${what} ${dev.name}`);
    console.log(`      login     ${username}`);
    console.log(`      role      SUPERUSER - clears every portal, listed in none`);
  }

  console.log(`\n  ${roster.length} developer accounts ready. Sign in at the dev portal, password tab:`);
  console.log(`      prod   https://dev.jeevamultispecialityhospital.com/login`);
  console.log(`      local  http://dev.localhost:3000/login`);
  console.log(`\n  The OTP tab does not work in production - no email provider is wired.\n`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
