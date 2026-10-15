import { test, expect } from '@playwright/test';

test.describe('Room Sync & Realtime Two-Window Verification', () => {
  test('Two browser windows: create room, join by code, verify play/pause/seek, chat, reactions, seats', async ({
    browser,
  }) => {
    // 1. Create two isolated browser contexts (two separate users) with guest identity
    const context1 = await browser.newContext();
    const context2 = await browser.newContext();

    await context1.addInitScript(() => {
      localStorage.setItem('watchparty_user', JSON.stringify({ id: 'usr_patron_1', displayName: 'Patron-1', isGuest: true }));
      localStorage.setItem('watchparty_username', 'Patron-1');
    });
    await context2.addInitScript(() => {
      localStorage.setItem('watchparty_user', JSON.stringify({ id: 'usr_patron_2', displayName: 'Patron-2', isGuest: true }));
      localStorage.setItem('watchparty_username', 'Patron-2');
    });

    const page1 = await context1.newPage();
    const page2 = await context2.newPage();

    page1.on('console', msg => console.log('PAGE1:', msg.text()));
    page1.on('pageerror', err => console.log('PAGE1 ERR:', err.message));
    page2.on('console', msg => console.log('PAGE2:', msg.text()));
    page2.on('pageerror', err => console.log('PAGE2 ERR:', err.message));

    console.log('\n--- STARTING TWO-WINDOW VERIFICATION ---\n');

    // TEST CHECK 1: Room Not Found check
    console.log('Testing: Room not found for non-existent code...');
    await page1.goto('http://localhost:3000/room/NONEXIST99');
    await expect(page1.getByText('Room not found')).toBeVisible({ timeout: 10000 });
    const backBtn = page1.getByRole('link', { name: 'Back to lobby' });
    await expect(backBtn).toBeVisible();
    console.log('CHECK: Room not found for non-existent code -> PASS');

    // TEST CHECK 2: Create room from Lobby / Landing
    console.log('Testing: Create room produces real room code...');
    await page1.goto('http://localhost:3000/lobby');
    await page1.waitForLoadState('networkidle');

    // Click "+ Create room"
    const createBtn = page1.getByRole('button', { name: '+ Create room' });
    await expect(createBtn).toBeVisible();
    await createBtn.click();

    // Should navigate to /room/[code]
    await page1.waitForURL(/\/room\/[A-Z0-9_-]+/i, { timeout: 15000 });
    const roomUrl = page1.url();
    const roomCodeMatch = roomUrl.match(/\/room\/([A-Z0-9_-]+)/i);
    expect(roomCodeMatch).not.toBeNull();
    const roomCode = roomCodeMatch![1];
    expect(roomCode).not.toBe('RM-4F7K');
    console.log(`CHECK: Created real room with code "${roomCode}" -> PASS`);

    // Wait for Page 1 to connect to the room
    await expect(page1.locator('video')).toBeVisible({ timeout: 10000 });
    await expect(page1.getByText(roomCode, { exact: true })).toBeVisible();

    // TEST CHECK 3: Window 2 joins by code
    console.log(`Testing: Window 2 joins room by code "${roomCode}"...`);
    await page2.goto(`http://localhost:3000/room/${roomCode}`);
    await page2.waitForLoadState('networkidle');
    await expect(page2.locator('video')).toBeVisible({ timeout: 10000 });
    await expect(page2.getByText(roomCode, { exact: true })).toBeVisible();
    console.log('CHECK: Window 2 joined room by code -> PASS');

    // TEST CHECK 4: Member seats update in both windows
    console.log('Testing: Member seats presence in both windows...');
    // In Page 1, there should now be 2 seats
    await expect(page1.locator('[data-seat="true"]')).toHaveCount(2, { timeout: 10000 });
    // In Page 2, there should also be 2 seats
    await expect(page2.locator('[data-seat="true"]')).toHaveCount(2, { timeout: 10000 });
    console.log('CHECK: Member seats update in both windows -> PASS');

    // TEST CHECK 5: Chat send and receive in both windows
    console.log('Testing: Chat communication between windows...');
    const messageInput1 = page1.getByPlaceholder('Message');
    await messageInput1.fill('Hello from Window 1!');
    await page1.getByRole('button', { name: 'Send' }).click();

    // Window 2 receives Window 1's message
    await expect(page2.getByText('Hello from Window 1!')).toBeVisible({ timeout: 8000 });

    // Window 2 replies
    const messageInput2 = page2.getByPlaceholder('Message');
    await messageInput2.fill('Greetings from Window 2!');
    await page2.getByRole('button', { name: 'Send' }).click();

    // Window 1 receives Window 2's reply
    await expect(page1.getByText('Greetings from Window 2!')).toBeVisible({ timeout: 8000 });
    console.log('CHECK: Real chat send and receive in both windows -> PASS');

    // TEST CHECK 6: Reactions counter and heat track update in both windows
    console.log('Testing: Reaction events and counter sync...');
    const reactBtn1 = page1.locator('button[title="React"], button[title="Click to react"]');
    const reactBtn2 = page2.locator('button[title="React"], button[title="Click to react"]');
    await expect(reactBtn1).toContainText('0');
    await expect(reactBtn2).toContainText('0');

    // Window 1 clicks reaction
    await reactBtn1.click();

    // Both windows should update count to 1
    await expect(reactBtn1).toContainText('1', { timeout: 5000 });
    await expect(reactBtn2).toContainText('1', { timeout: 5000 });
    console.log('CHECK: Reactions counter and broadcast update in both windows -> PASS');

    // TEST CHECK 7: Play/Pause/Seek synchronization
    console.log('Testing: Play/pause/seek synchronization...');
    // Window 1 clicks play
    const playOverlay1 = page1.locator('[data-testid="play-overlay"]');
    if (await playOverlay1.isVisible()) {
      await playOverlay1.click();
    } else {
      await page1.locator('video').click({ force: true });
    }

    // Verify sync engine sets data-playing="true" in Window 1 and Window 2
    await expect(page1.locator('[data-playing="true"]')).toBeVisible({ timeout: 8000 });
    await expect(page2.locator('[data-playing="true"]')).toBeVisible({ timeout: 8000 });
    console.log('SUB-CHECK: Play state synchronized -> PASS');

    // Window 1 pauses by clicking video
    await page1.locator('video').click({ force: true });

    // Verify sync engine sets data-playing="false" in Window 1 and Window 2
    await expect(page1.locator('[data-playing="false"]')).toBeVisible({ timeout: 8000 });
    await expect(page2.locator('[data-playing="false"]')).toBeVisible({ timeout: 8000 });
    console.log('SUB-CHECK: Pause state synchronized -> PASS');

    // Window 1 seeks via progress bar
    const scrubberTrack = page1.locator('[data-testid="scrubber-track"]');
    const box = await scrubberTrack.boundingBox();
    if (box) {
      // Click at 50% of scrubber
      await page1.mouse.click(box.x + box.width * 0.5, box.y + box.height / 2);
    }
    await page1.waitForTimeout(1000);

    const time1 = await page1.evaluate(() => {
      const v = document.querySelector('video');
      return v ? v.currentTime : 0;
    });
    expect(time1).toBeGreaterThan(0);

    // Window 2 should be within 2 seconds of Window 1's seek position
    await expect.poll(async () => {
      const time2 = await page2.evaluate(() => {
        const v = document.querySelector('video');
        return v ? v.currentTime : 0;
      });
      return Math.abs(time2 - time1);
    }, { timeout: 8000 }).toBeLessThan(2.0);
    console.log('SUB-CHECK: Seek position synchronized -> PASS');
    console.log('CHECK: Play/Pause/Seek sync engine -> PASS');

    // TEST CHECK 8: Speaking ring from voice events
    console.log('Testing: Speaking ring presence...');
    // Click own seat in Window 1 to toggle microphone / speaking status
    const ownSeat1 = page1.locator('[title*="toggle mic"], [title*="toggle your microphone"]');
    await ownSeat1.click();
    await page1.waitForTimeout(1000);

    const p2State = await page2.evaluate(() => {
      const seats = Array.from(document.querySelectorAll('[data-seat="true"]'));
      return seats.map(s => ({
        text: s.textContent,
        speaking: s.getAttribute('data-speaking')
      }));
    });
    console.log('P2 SEATS DUMP:', JSON.stringify(p2State));

    // Window 2 should observe cathode speaking ring glow on Window 1's seat
    const glowingSeatInWin2 = page2.locator('[data-seat="true"][data-speaking="true"]');
    await expect(glowingSeatInWin2).toBeVisible({ timeout: 5000 });
    console.log('CHECK: Cathode speaking ring voice state sync -> PASS');

    // Clean up
    await context1.close();
    await context2.close();
    console.log('\n--- ALL TWO-WINDOW VERIFICATION CHECKS PASSED ---\n');
  });
});
