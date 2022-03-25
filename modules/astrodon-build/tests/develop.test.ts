import { Develop } from "../mod.ts";
import { AppConfig } from "../../astrodon/mod.ts";
import {
  dirname,
  fromFileUrl,
  join,
} from "https://deno.land/std@0.131.0/path/mod.ts";
import { serve } from "https://deno.land/std@0.131.0/http/mod.ts";

import messages from "./messages.ts";
const __dirname = dirname(fromFileUrl(import.meta.url));

const config: AppConfig = {
  entry: join(__dirname, "./mod.ts"),
  dist: join(__dirname, "./dist"),
  info: {
    name: "astrodon-build",
    version: "0.0.1",
    id: "astrodon-build",
    longDescription: "Astrodon Build",
    shortDescription: "Astrodon Build",
    copyright: "",
    author: "",
    homepage: "",
    icon: [],
    resources: [],
    permissions: {
      allow_hrtime: true,
      prompt: true,
      allow_net: [],
    },
  },
};

Deno.test({
  name: "develop",
  fn: async () => {
    const develop = new Develop(config);
    develop.run();

    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(reject, 15000);
      const controller = new AbortController();

      function reqHandler(req: Request) {
        if (req.headers.get("upgrade") != "websocket") {
          return new Response(null, { status: 501 });
        }

        const { socket, response } = Deno.upgradeWebSocket(req);

        socket.onmessage = (ev) => {
          const msg = ev.data.toString();
          if (msg === messages.success) {
            clearTimeout(timeout);
            socket.close();
            controller.abort();
            resolve();
          }
        };
        return response;
      }

      serve(reqHandler, { port: 8000, signal: controller.signal });
    });

    develop.close();
  },
  sanitizeOps: false,
  sanitizeResources: false,
});
