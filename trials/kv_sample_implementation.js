/// <reference types="@fastly/js-compute" />

import { KVStore } from "fastly:kv-store";

async function app(event) { 
  const store = new KVStore("example_store");

  await store.put("my-key", "my-value")

  const entry = await store.get("my-key")
  const entry1 = await store.get("first")

  console.log("entry", await entry.text())
  console.log("entry1", await entry1.text())
}

addEventListener("fetch", (event) => event.respondWith(app(event)))
