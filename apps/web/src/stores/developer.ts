import { defineStore } from "pinia";
import { canManageHost } from "@/lib/auth";
import { settingsStorage } from "@/stores/settings";

export const useDeveloperStore = defineStore("developer", {
  state: () => ({ developerConfirmed: false }),
  persist: { key: "toonflow.developer", storage: {
    getItem: key => (canManageHost.value ? localStorage : settingsStorage).getItem(key),
    setItem: (key, value) => (canManageHost.value ? localStorage : settingsStorage).setItem(key, value),
  } },
});
