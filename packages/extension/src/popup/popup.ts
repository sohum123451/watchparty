// Popup script for WatchParty Chrome Extension

document.addEventListener("DOMContentLoaded", async () => {
  const roomInput = document.getElementById("roomInput") as HTMLInputElement;
  const serverInput = document.getElementById("serverInput") as HTMLInputElement;
  const hostToggle = document.getElementById("hostToggle") as HTMLInputElement;
  const joinBtn = document.getElementById("joinBtn") as HTMLButtonElement;
  const leaveBtn = document.getElementById("leaveBtn") as HTMLButtonElement;
  const toggleAdvancedBtn = document.getElementById("toggleAdvancedBtn") as HTMLButtonElement;
  const advancedFields = document.getElementById("advancedFields") as HTMLElement;

  const connectionBadge = document.getElementById("connectionBadge") as HTMLElement;
  const connectionText = document.getElementById("connectionText") as HTMLElement;
  const displayRoom = document.getElementById("displayRoom") as HTMLElement;
  const displayDrift = document.getElementById("displayDrift") as HTMLElement;
  const displayStatus = document.getElementById("displayStatus") as HTMLElement;
  const displayTabs = document.getElementById("displayTabs") as HTMLElement;
  const roleBadge = document.getElementById("roleBadge") as HTMLElement;

  // Toggle advanced settings
  toggleAdvancedBtn.addEventListener("click", () => {
    advancedFields.classList.toggle("hidden");
  });

  // Query background service worker for status
  async function refreshStatus(): Promise<void> {
    try {
      const res = await chrome.runtime.sendMessage({ action: "GET_STATUS" });
      if (res && res.success) {
        updateUI(res);
      }
    } catch (e) {
      console.warn("Could not reach background worker:", e);
    }
  }

  function updateUI(status: any): void {
    if (status.connected && status.roomId) {
      connectionBadge.className = "badge badge-connected";
      connectionText.textContent = "Connected";
      joinBtn.classList.add("hidden");
      leaveBtn.classList.remove("hidden");
      roomInput.disabled = true;
      roomInput.value = status.roomId;

      displayRoom.textContent = status.roomId;
      displayTabs.textContent = `${status.connectedTabs || 1} Tab(s)`;
    } else {
      connectionBadge.className = "badge badge-disconnected";
      connectionText.textContent = "Disconnected";
      joinBtn.classList.remove("hidden");
      leaveBtn.classList.add("hidden");
      roomInput.disabled = false;

      displayRoom.textContent = "-";
      displayTabs.textContent = "0 Tabs";
      displayDrift.textContent = "0 ms";
      displayStatus.textContent = "Idle";
      displayStatus.className = "metric-val";
    }

    if (status.serverUrl) {
      serverInput.value = status.serverUrl;
    }

    hostToggle.checked = !!status.isHost;
    if (status.isHost) {
      roleBadge.textContent = "Host";
      roleBadge.className = "pill pill-host";
    } else {
      roleBadge.textContent = "Member";
      roleBadge.className = "pill pill-member";
    }
  }

  // Join Room
  joinBtn.addEventListener("click", async () => {
    const roomId = roomInput.value.trim().toUpperCase();
    if (!roomId) {
      roomInput.focus();
      return;
    }

    const serverUrl = serverInput.value.trim() || "ws://localhost:3000/ws";
    const isHost = hostToggle.checked;

    joinBtn.disabled = true;
    joinBtn.textContent = "Connecting...";

    try {
      await chrome.runtime.sendMessage({
        action: "JOIN_ROOM",
        roomId,
        serverUrl,
        isHost
      });
      await refreshStatus();
    } catch (err) {
      console.error("Failed to join room:", err);
    } finally {
      joinBtn.disabled = false;
      joinBtn.textContent = "Join Room";
    }
  });

  // Leave Room
  leaveBtn.addEventListener("click", async () => {
    leaveBtn.disabled = true;
    try {
      await chrome.runtime.sendMessage({ action: "LEAVE_ROOM" });
      await refreshStatus();
    } finally {
      leaveBtn.disabled = false;
    }
  });

  // Toggle Host
  hostToggle.addEventListener("change", async () => {
    const isHost = hostToggle.checked;
    await chrome.runtime.sendMessage({
      action: "SET_HOST_MODE",
      isHost
    });
    await refreshStatus();
  });

  // Storage listener for reactive updates
  chrome.storage.onChanged.addListener((changes) => {
    if (changes.roomId || changes.connected || changes.isHost) {
      refreshStatus();
    }
  });

  // Initial load
  await refreshStatus();
});
