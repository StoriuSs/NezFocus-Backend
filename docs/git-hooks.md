<!-- START doctoc generated TOC please keep comment here to allow auto update -->
<!-- DON'T EDIT THIS SECTION, INSTEAD RE-RUN doctoc TO UPDATE -->
**Table of Contents**  *generated with [DocToc](https://github.com/thlorenz/doctoc)*

- [Git Hooks (Husky)](#git-hooks-husky)
  - [🤔 What are Git Hooks?](#-what-are-git-hooks)
    - [Without Git Hooks](#without-git-hooks)
    - [With Git Hooks](#with-git-hooks)
  - [🛠️ What We Use](#-what-we-use)
    - [Husky](#husky)
    - [lint-staged](#lint-staged)
  - [🔗 Our Setup](#-our-setup)
  - [📝 What Happens When You Commit](#-what-happens-when-you-commit)
    - [Step-by-Step](#step-by-step)
  - [📤 What Happens When You Push](#-what-happens-when-you-push)
    - [Step-by-Step](#step-by-step-1)
  - [🚨 Bypassing Hooks (Emergency Only)](#-bypassing-hooks-emergency-only)
  - [🎯 Benefits](#-benefits)
  - [📦 Dependencies Explained](#-dependencies-explained)
    - [Installed Packages](#installed-packages)
  - [🔧 Configuration Files](#-configuration-files)
    - [`.husky/pre-commit`](#huskypre-commit)
    - [`.husky/pre-push`](#huskypre-push)
    - [`package.json` — `lint-staged` config](#packagejson--lint-staged-config)
  - [🤝 For New Contributors](#-for-new-contributors)
  - [📚 Further Reading](#-further-reading)

<!-- END doctoc generated TOC please keep comment here to allow auto update -->

# Git Hooks (Husky)

This project uses **Git hooks** to automatically check your code before committing or pushing.

## 🤔 What are Git Hooks?

Git hooks are **automatic scripts that run at specific points** in your Git workflow. Think of them as safety checks that prevent bad code from entering the repository.

### Without Git Hooks
```
1. You write code with a typo
2. You commit it → ✅ Committed
3. You push it → ✅ Pushed
4. CI/CD runs → ❌ Build fails
5. You waste time fixing and re-pushing
```

### With Git Hooks
```
1. You write code with a typo
2. You commit it → ❌ Pre-commit hook finds error, auto-fixes it
3. You push it → ✅ Pre-push hook runs tests, all pass
4. CI/CD runs → ✅ Build succeeds
```

---

## 🛠️ What We Use

### Husky
**What it is:** A tool that makes it easy to set up Git hooks.

**What it does:** Husky runs scripts automatically at specific Git events (before commit, before push, etc.).

**Analogy:** Like a security guard that checks everyone before they enter/exit a building.

### lint-staged
**What it is:** A tool that runs commands **only on files you've changed** (staged for commit).

**What it does:** Instead of linting your ENTIRE codebase (slow), it only checks the files you're about to commit (fast).

**Analogy:** Like a customs officer who only checks your luggage, not everyone else's at the airport.

---

## 🔗 Our Setup

| Hook | When it runs | What it does | Why |
|------|--------------|--------------|-----|
| **pre-commit** | Before each commit | `eslint --fix` + `prettier --write` on staged `.ts` and `.js` files | Auto-fixes linting and formatting errors |
| **pre-push** | Before each push | `pnpm test && pnpm test:e2e` | Nothing reaches a branch that fails its own tests |

---

## 📝 What Happens When You Commit

### Step-by-Step
```bash
git add src/modules/users/presentation/http/users.controller.ts
git commit -m "Add new endpoint"
```

**Behind the scenes:**
1. **Husky triggers** the pre-commit hook
2. **lint-staged runs** `eslint --fix` and `prettier --write` on `users.controller.ts`
3. **ESLint checks** for errors and auto-fixes simple issues
4. **Prettier formats** the code to match project style
5. If no errors → Commit succeeds ✅
6. If unfixable errors → Commit fails ❌ (you must fix manually)

---

## 📤 What Happens When You Push

### Step-by-Step
```bash
git push
```

**Behind the scenes:**
1. **Husky triggers** the pre-push hook
2. **`pnpm test && pnpm test:e2e` runs** — the unit and end-to-end suites
3. If tests pass → Push succeeds ✅
4. If tests fail → Push blocked ❌ (must fix failing tests first)

The **integration** suite is not here. It needs Postgres, Redis, RustFS and
Mailpit running, which a push hook cannot assume: `pnpm test:services:up && pnpm test:integration`
when you want it, and CI runs it on every branch.

That matters most for sign-in. The auth module's real checks (sign-up with an
emailed code, refresh and reuse detection, Google sign-in against a fake
provider, two-step sign-in, the encryption key) live in the integration
suites `auth`, `auth-http`, `oauth-http`, `two-step-http`,
`encryption-key` and `account-lifecycle`. A change that breaks them passes the
pre-push hook. When you touch `src/modules/auth/`, run them before you push:

```bash
pnpm test:services:up
pnpm test:integration -- auth oauth two-step encryption account-lifecycle
```

The list of every suite is in [testing.md](./testing.md#integration-tests).

---

## 🚨 Bypassing Hooks (Emergency Only)

If you **absolutely must** skip hooks (not recommended):

```bash
# Skip pre-commit hook
git commit -m "fix" --no-verify

# Skip pre-push hook
git push --no-verify
```

**⚠️ Warning:** Only use this in emergencies. Skipping hooks defeats their purpose!

---

## 🎯 Benefits

| Benefit | Impact |
|---------|--------|
| **Catches errors early** | Fix issues before they reach CI/CD |
| **Auto-fixes simple problems** | Saves manual work |
| **Maintains code quality** | Consistent style across all contributors |
| **Faster feedback** | Know about issues in seconds, not minutes |
| **Prevents broken builds** | Tests must pass before pushing |

---

## 📦 Dependencies Explained

### Installed Packages

```json
{
  "husky": "^9.1.7",        // Git hooks made easy
  "lint-staged": "^16.2.7"  // Run commands on staged files only
}
```

**Why we need both:**
- **Husky** manages _when_ hooks run (before commit, before push)
- **lint-staged** manages _what_ files to check (only your changes)

Together, they create a fast, efficient quality check system.

---

## 🔧 Configuration Files

### `.husky/pre-commit`
```bash
pnpm exec lint-staged
```
Runs lint-staged on the files about to be committed.

### `.husky/pre-push`
```bash
pnpm test && pnpm test:e2e
```

### `package.json` — `lint-staged` config
```json
"lint-staged": {
  "*.{ts,js}": [
    "eslint --fix",
    "prettier --write"
  ]
}
```
ESLint and Prettier, on the staged TypeScript and JavaScript files only —
which is what makes the hook fast enough that nobody wants to skip it.

---

## 🤝 For New Contributors

When someone clones this repo and runs `pnpm install`:
1. Husky automatically installs (via `prepare` script in `package.json`)
2. Git hooks are automatically set up in `.husky/`
3. They're immediately protected by quality checks

No manual setup needed! 🎉

---

## 📚 Further Reading

- [Husky Documentation](https://typicode.github.io/husky/)
- [lint-staged Documentation](https://github.com/lint-staged/lint-staged)
- [Git Hooks Explained](https://git-scm.com/book/en/v2/Customizing-Git-Git-Hooks)
