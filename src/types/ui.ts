import type { ReactNode } from "react";
import type { CommandError } from "@/types/command";

export type PageProps = { title: string; description: string; children: ReactNode };

export type CommandErrorAlertProps = { title: string; error: CommandError };

export type InfoRowProps = { label: string; loading: boolean; children: ReactNode };
