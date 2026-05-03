import { test, expect } from "@playwright/test";

test.describe("Recordings", () => {
  let recordingId: string;

  test.beforeAll(async ({ request }) => {
    const res = await request.post("/api/recordings", {
      data: {
        title: "E2E Test Recording",
        fileName: "e2e-test.m4a",
        ossKey: "test/e2e-test.m4a",
        status: "uploaded",
      },
    });
    expect(res.ok()).toBeTruthy();
    const body = (await res.json()) as { id: string };
    recordingId = body.id;
  });

  test.afterAll(async ({ request }) => {
    if (recordingId) {
      await request.delete(`/api/recordings/${recordingId}`);
    }
  });

  test("list page renders recordings", async ({ page }) => {
    await page.goto("/recordings");

    await expect(
      page.getByRole("heading", { name: "Recordings" }),
    ).toBeVisible();
    await expect(page.getByText("E2E Test Recording")).toBeVisible({
      timeout: 10_000,
    });
  });

  test("detail page renders recording metadata", async ({ page }) => {
    await page.goto(`/recordings/${recordingId}`);

    await expect(page.getByText("E2E Test Recording")).toBeVisible({
      timeout: 10_000,
    });
    await expect(page.getByText("e2e-test.m4a")).toBeVisible();
  });
});
