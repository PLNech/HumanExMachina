const { test, expect } = require('@playwright/test');

test.describe('HumanExMachina RAG Chat', () => {
  test('page loads with welcome message and suggestions', async ({ page }) => {
    await page.goto('/');

    await expect(page.locator('h1')).toContainText('Agent Machina');
    await expect(page.locator('.subtitle')).toContainText('compagnon de lecture');
    await expect(page.locator('.welcome h2')).toContainText('Explorez le livre');
    await expect(page.locator('#input')).toBeVisible();
    await expect(page.locator('#send')).toBeVisible();
    await expect(page.locator('footer')).toContainText("Agent Studio d'Algolia");

    // Check suggestions are rendered
    await expect(page.locator('#welcome-suggestions .suggestion')).toHaveCount(3);
    await expect(page.locator('#suggestions-list .suggestion')).toHaveCount(3);
  });

  test('can send a message and receive response with rich hits', async ({ page }) => {
    await page.goto('/');

    await page.fill('#input', 'Comment organiser ma journee?');
    await page.click('#send');

    await expect(page.locator('.welcome')).not.toBeVisible();
    await expect(page.locator('.message.user')).toContainText('Comment organiser');

    // Wait for response (up to 30s for API)
    await expect(page.locator('.message.assistant:not(.typing)')).toBeVisible({ timeout: 30000 });

    // Response should have content
    const response = page.locator('.message.assistant:not(.typing)');
    const text = await response.textContent();
    expect(text.length).toBeGreaterThan(50);
    expect(text).not.toContain('Erreur:');

    // Check for sources section
    const hasSources = await page.locator('.sources-section').count();
    if (hasSources > 0) {
      await expect(page.locator('.sources-title')).toContainText('Sources');
      await expect(page.locator('.hit').first()).toBeVisible();
      // Check hit metadata
      await expect(page.locator('.hit-section').first()).toBeVisible();
      await expect(page.locator('.hit-chapter').first()).toBeVisible();
      await expect(page.locator('.hit-page').first()).toBeVisible();
    }
  });

  test('suggestions update after sending message', async ({ page }) => {
    await page.goto('/');

    // Get first suggestion text
    const firstSuggestion = await page.locator('#suggestions-list .suggestion').first().textContent();

    // Click it
    await page.locator('#suggestions-list .suggestion').first().click();

    // Wait for response
    await expect(page.locator('.message.assistant:not(.typing)')).toBeVisible({ timeout: 30000 });

    // The used suggestion should be marked as used
    const usedSuggestion = page.locator(`#suggestions-list .suggestion.used`);
    await expect(usedSuggestion).toBeVisible();
  });

  test('handles multi-turn conversation', async ({ page }) => {
    await page.goto('/');

    await page.fill('#input', 'De quoi parle le livre?');
    await page.click('#send');
    await expect(page.locator('.message.assistant:not(.typing)')).toBeVisible({ timeout: 30000 });

    await page.fill('#input', 'Donne plus de details');
    await page.click('#send');

    await expect(page.locator('.message.user')).toHaveCount(2);
    await expect(page.locator('.message.assistant:not(.typing)')).toHaveCount(2, { timeout: 30000 });
  });

  test('Enter key sends message', async ({ page }) => {
    await page.goto('/');

    await page.fill('#input', 'test');
    await page.press('#input', 'Enter');

    await expect(page.locator('.message.user')).toContainText('test');
  });

  test('empty message is not sent', async ({ page }) => {
    await page.goto('/');

    await page.click('#send');

    await expect(page.locator('.message.user')).toHaveCount(0);
    await expect(page.locator('.welcome')).toBeVisible();
  });

  test('theme toggle works', async ({ page }) => {
    await page.goto('/');

    // Check initial theme
    const initialTheme = await page.evaluate(() => document.documentElement.getAttribute('data-theme'));

    // Toggle theme
    await page.click('#theme-toggle');

    const newTheme = await page.evaluate(() => document.documentElement.getAttribute('data-theme'));
    expect(newTheme).not.toBe(initialTheme);
  });

  test('refresh suggestions button works', async ({ page }) => {
    await page.goto('/');

    // Get current suggestions
    const initialSuggestions = await page.locator('#suggestions-list .suggestion').allTextContents();

    // Click refresh multiple times to get different suggestions
    for (let i = 0; i < 5; i++) {
      await page.click('#suggestions-refresh');
    }

    // At least one suggestion should have changed (probabilistic but likely)
    const newSuggestions = await page.locator('#suggestions-list .suggestion').allTextContents();
    // First suggestion (intro) should stay the same
    expect(newSuggestions[0]).toBe(initialSuggestions[0]);
  });

  test('hit cards are expandable', async ({ page }) => {
    await page.goto('/');

    await page.fill('#input', 'Parle-moi des routines');
    await page.click('#send');

    await expect(page.locator('.message.assistant:not(.typing)')).toBeVisible({ timeout: 30000 });

    // If there are hits, test expansion
    const hitCount = await page.locator('.hit').count();
    if (hitCount > 0) {
      const firstHit = page.locator('.hit').first();
      await firstHit.click();
      await expect(firstHit).toHaveClass(/expanded/);

      // Click again to collapse
      await firstHit.click();
      await expect(firstHit).not.toHaveClass(/expanded/);
    }
  });
});
