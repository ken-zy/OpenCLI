import { cli, Strategy } from '@jackwener/opencli/registry';

// Locate the Codex sidebar project list via fingerprint, not text:
//   1. Inside <aside> (sidebar scope; reduces collisions with other role=list on the page).
//   2. <div role=list> without aria-label.
//   3. First child = <div role=listitem aria-label="X"> whose inner
//      <div role=button> shares the same aria-label and carries aria-expanded.
// The "listitem.aria-label === inner-button.aria-label" + aria-expanded combo is
// Codex's self-similar a11y convention for project rows; other lists (recent chats,
// per-project sub-operations) don't satisfy it. i18n-safe because no text is matched.
const FINGERPRINT_FN = `function findProjectList(scope) {
  const candidates = scope.querySelectorAll('div[role=list]:not([aria-label])');
  for (const list of candidates) {
    const item = list.querySelector(':scope > div[role=listitem][aria-label]');
    if (!item) continue;
    const itemLabel = item.getAttribute('aria-label');
    const btn = item.querySelector('div[role=button][aria-label][aria-expanded]');
    if (btn && btn.getAttribute('aria-label') === itemLabel) return list;
  }
  return null;
}`;

async function listSidebarProjects(page) {
    const names = await page.evaluate(`
    (function() {
      ${FINGERPRINT_FN}
      const list = findProjectList(document.querySelector('aside') || document);
      if (!list) return [];
      return Array.from(list.querySelectorAll(':scope > div[role=listitem][aria-label]'))
        .map(el => el.getAttribute('aria-label'));
    })()
  `);
    return Array.isArray(names) ? names : [];
}

async function clickProject(page, name) {
    const result = await page.evaluate(`
    (function(target) {
      ${FINGERPRINT_FN}
      const list = findProjectList(document.querySelector('aside') || document);
      if (!list) return { ok: false, reason: 'no-project-list' };
      const items = list.querySelectorAll(':scope > div[role=listitem][aria-label]');
      let item = null;
      for (const el of items) {
        if (el.getAttribute('aria-label') === target) { item = el; break; }
      }
      if (!item) return { ok: false, reason: 'project-not-in-list' };
      // Click the button directly by aria-label rather than relying on a
      // listitem -> child[role=button] traversal, so a future swap to a native
      // <button> still works. Falls back to the listitem itself if neither exists.
      const clickable = item.querySelector('div[role=button], button') || item;
      const btnForState = item.querySelector('div[role=button][aria-expanded], button[aria-expanded]');
      const wasExpanded = btnForState ? btnForState.getAttribute('aria-expanded') === 'true' : null;
      clickable.scrollIntoView({block: 'nearest'});
      clickable.click();
      return { ok: true, wasExpanded };
    })(${JSON.stringify(name)})
  `);
    if (!result.ok) {
        throw new Error(`Failed to click project '${name}': ${result.reason}`);
    }
    if (result.wasExpanded === false) {
        // Was collapsed; verify click flipped it to expanded (catches silent UI race).
        await waitForProjectExpanded(page, name, 3000);
        return;
    }
    // Already expanded (or no aria-expanded attr): no objective verify available;
    // give the click handler a brief beat for side-effects.
    await page.wait(0.3);
}

async function waitForProjectExpanded(page, name, timeoutMs) {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
        const expanded = await page.evaluate(`
      (function(target) {
        ${FINGERPRINT_FN}
        const list = findProjectList(document.querySelector('aside') || document);
        if (!list) return false;
        const items = list.querySelectorAll(':scope > div[role=listitem][aria-label]');
        for (const el of items) {
          if (el.getAttribute('aria-label') !== target) continue;
          const btn = el.querySelector('div[role=button][aria-expanded], button[aria-expanded]');
          return btn ? btn.getAttribute('aria-expanded') === 'true' : false;
        }
        return false;
      })(${JSON.stringify(name)})
    `);
        if (expanded) return;
        await page.wait(0.1);
    }
    throw new Error(`Timed out (${timeoutMs}ms) waiting for project '${name}' to expand after click`);
}

export const newCommand = cli({
    site: 'codex',
    name: 'new',
    description: 'Start a new Codex chat; optionally scope to a specific sidebar project',
    domain: 'localhost',
    strategy: Strategy.UI,
    browser: true,
    args: [
        {
            name: 'project',
            type: 'str',
            required: false,
            valueRequired: true,
            help: 'Exact sidebar project name to switch to before creating the chat (case-sensitive)',
        },
    ],
    columns: ['Status', 'Project'],
    func: async (page, kwargs) => {
        let target = null;
        if (kwargs.project !== undefined) {
            target = kwargs.project.trim();
            if (!target) {
                throw new Error('--project cannot be empty');
            }
        }
        if (target) {
            const available = await listSidebarProjects(page);
            if (!available.includes(target)) {
                const list = available.length
                    ? available.map((n) => `  - ${n}`).join('\n')
                    : '  (none detected — is the sidebar collapsed?)';
                throw new Error(
                    `Project '${target}' not found in Codex sidebar.\nAvailable projects:\n${list}`,
                );
            }
            await clickProject(page, target);
        }
        const isMac = process.platform === 'darwin';
        await page.pressKey(isMac ? 'Meta+N' : 'Control+N');
        await page.wait(1);
        return [{ Status: 'Success', Project: target || '(current)' }];
    },
});
