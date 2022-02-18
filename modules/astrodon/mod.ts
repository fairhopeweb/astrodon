import { dirname, join, Plug } from "./deps.ts";
import {
  getAppOptions,
  getAppPathByContext,
  getLibraryLocation,
  prepareUrl,
} from "./utils.ts";
import meta from "../../astrodon.meta.ts";
import "./astrodon.d.ts";

/*
 * This is a bit hacky, it automatically closes the cmd window
 * it opens when the app is launched from a executable generated by `deno compile`
 */
// if (Deno.build.os === "windows" && Deno.env.get("DEV") != "true") {
//   const mod = Deno.dlopen("kernel32.dll", {
//     FreeConsole: {
//       parameters: [],
//       result: "void",
//     },
//   });
//   mod.symbols.FreeConsole();
// }

/*
 * MacOS is not supported yet
 * See https://github.com/astrodon/astrodon/issues/11
 */
if (Deno.build.os === "darwin") {
  console.log(
    `
MacOS is not supported sorry :(
See https://github.com/astrodon/astrodon/issues/11
`,
  );
}

interface WindowConfig {
  title: string;
  url: string;
}

interface AppConfig {
  windows: WindowConfig[];
}

export interface AppContext {
  bin?: unknown;
  options?: AppOptions;
}

export interface AppOptions {
  name?: string;
  version?: string;
  build?: {
    entry?: string;
    preventUnpack?: boolean;
    out?: string;
    assets?: string;
  };
}

interface AppMethods extends Record<string, Deno.ForeignFunction> {
  create_app: { parameters: ["pointer", "usize"]; result: "pointer" };
  run_app: { parameters: ["pointer"]; result: "pointer" };
  send_message: {
    parameters: ["pointer", "usize", "pointer"];
    result: "pointer";
  };
}

/**
 *  Create a new app
 */

export class App {
  private windows: WindowConfig[];
  private lib: Deno.DynamicLibrary<AppMethods>;
  private app_ptr: Deno.UnsafePointer | undefined;

  constructor(
    lib: Deno.DynamicLibrary<AppMethods>,
    windows: WindowConfig[],
    public globalContext: AppContext,
  ) {
    this.windows = windows;
    this.lib = lib;
  }

  public static async new(options = {}) {
    options = Object.assign(await getAppOptions(), options) as AppOptions;

    const context: AppContext = {
      bin: window.astrodonBin,
      options,
    };

    const libPath = await getLibraryLocation(context);

    const plugOptions: Plug.Options = {
      name: "astrodon",
      url: libPath,
      policy: Plug.CachePolicy.NONE,
    };

    const libraryMethods: AppMethods = {
      create_app: { parameters: ["pointer", "usize"], result: "pointer" },
      run_app: { parameters: ["pointer"], result: "pointer" },
      send_message: {
        parameters: ["pointer", "usize", "pointer"],
        result: "pointer",
      },
    };

    const library = await Plug.prepare(plugOptions, libraryMethods);

    return new App(library, [], context);
  }

  /**
   * Registers windows on Deno's side
   * Dev Note: we should register directly on rust to handle the windows as instances
   * This is still not possible since we don't have callbacks support with FFI.
   * See: https://github.com/denoland/deno/pull/13162
   */

  public async registerWindow(window: WindowConfig) {
    window.url = await prepareUrl(window.url, this.globalContext);
    this.windows.push(window);
  }

  /**
   * App.getAppPath() returns the path where the app is located including assets and executable
   * It is dynamic and depends on the environment and context of the app
   * This is a user scope method.
   */

  public async getDataPath() {
    const homePath = Deno.env.get("HOME") || Deno.env.get("APPDATA") ||
      Deno.cwd();
    const customBinary = Deno.env.get("CUSTOM_BINARY");
    const binPath = customBinary
      ? dirname(await Deno.realPath(customBinary))
      : getAppPathByContext(this.globalContext);
    
    /**
     * Signature path is "astrodon" + the in use version of the astrodon module
     * Using a versioned url of astrodon is important to avoid conflicts with future releases of astrodon
     * Dev Note: We should include in built apps the version of astrodon used at build time and use it
     * instead of the version of the module used at runtime.
     */
    const signaTurePath = join(meta.name, meta.version);
    const removedHome = binPath.replace(homePath, "");

    if (removedHome.startsWith(join("/", signaTurePath))) {
      const root = removedHome.split(join("/"))[1];
      return binPath.substring(0, homePath.length + root.length + 1);
    }

    // If a custom binary is used, we provide the binaryPath as data path, this is intentional as it is the only path we can provide.

    if (!binPath.includes(signaTurePath)) return binPath;

    // The entry url result should be two folders up where the binary is located

    const astrodonIndex = binPath.indexOf(signaTurePath);
    return binPath.substring(0, astrodonIndex - 1);
  }

  // Run method to start the app

  public run(): void {
    const context: AppConfig = {
      windows: this.windows,
    };
    this.app_ptr = this.lib.symbols.create_app(
      ...encode(context),
    ) as Deno.UnsafePointer;
    this.app_ptr = this.lib.symbols.run_app(this.app_ptr) as Deno.UnsafePointer;
  }

  public send(msg: string): void {
    if (this.app_ptr) {
      this.app_ptr = this.lib.symbols.send_message(
        ...encode(msg),
        this.app_ptr,
      ) as Deno.UnsafePointer;
    }
  }
}

function encode(val: unknown): [Uint8Array, number] {
  const objectStr = JSON.stringify(val);
  const buf = new TextEncoder().encode(objectStr);
  return [buf, buf.length];
}
