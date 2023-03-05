import { InstanceBase, InstanceStatus, runEntrypoint, SomeCompanionConfigField } from "@companion-module/base";
import { Actions } from "./actions";
import { Config, DefaultConfig, GetConfig } from "./config";
import { Socket } from "./socket";
import { GetVariables } from "./variables";

export class ModuleInstance extends InstanceBase<Config> {
    private config: Config = DefaultConfig;
    private socket?: Socket;
    private actions: Actions;
    private fetchCommands?: NodeJS.Timeout;
    private fetchState?: NodeJS.Timeout;

    constructor(internal: any) {
        super(internal);

        this.actions = new Actions(
            (d) => this.setActionDefinitions(d),
            (command) => this.socket?.send("run-command", { command })
        );
    }

    async init(config: Config, isFirstInit: boolean) {
        // Set initial definitions
        this.setVariableDefinitions(GetVariables());
        this.setActionDefinitions(this.actions.getOtherActions());

        // Handle as config change
        await this.configUpdated(config);
    }

    async destroy() {
        if (this.fetchCommands) clearInterval(this.fetchCommands);
        if (this.fetchState) clearInterval(this.fetchState);
        await this.socket?.shutdown();
    }

    async configUpdated(config: Config) {
        // Set config
        this.config = config;

        // Restart socket
        await this.socket?.shutdown();
        this.socket = new Socket(
            this.config,
            (type: string, message: any) => this.handleMessage(type, message),
            (status: InstanceStatus) => this.updateStatus(status)
        );

        // Restart fetch intervals
        this.restartFetchIntervals();
    }

    getConfigFields(): SomeCompanionConfigField[] {
        return GetConfig();
    }

    private restartFetchIntervals() {
        // Restart command fetching
        if (this.fetchCommands) {
            clearInterval(this.fetchCommands);
            delete this.fetchCommands;
        }

        this.fetchCommands = setInterval(() => {
            this.socket?.send("list-commands");
        }, this.config.reloadCommands);

        // Restart state fetching
        if (this.fetchState) {
            clearInterval(this.fetchState);
            delete this.fetchState;
        }

        this.fetchState = setInterval(() => {
            this.socket?.send("get-version");
            this.socket?.send("get-editor");
        }, this.config.reloadState);
    }

    private handleMessage(type: string, message: any) {
        if (type === "get-version") {
            this.setVariableValues({ version: message.version });
        } else if (type === "get-editor" && "editor" in message) {
            const editor = message.editor;
            this.setVariableValues({ language: editor.document.languageId, lines: editor.document.lineCount });
        } else if (type === "list-commands") {
            this.setVariableValues({ commands: message.list.length });
            this.actions.setCommands(message.list);
        }
    }
}

runEntrypoint(ModuleInstance, []);
