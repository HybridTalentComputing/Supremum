import { invoke } from "@tauri-apps/api/core";

type ListDirEntry = {
  name: string;
  path: string;
  isDir: boolean;
};

export async function invokeListDir(
  workspacePath: string,
  path: string,
): Promise<ListDirEntry[]> {
  return invoke("list_dir", { payload: { workspacePath, path } });
}

export async function invokeReadFile(
  workspacePath: string,
  path: string,
): Promise<string> {
  return invoke("read_file", { payload: { workspacePath, path } });
}

export async function invokeCreateFile(
  workspacePath: string,
  path: string,
): Promise<void> {
  return invoke("create_file", { payload: { workspacePath, path } });
}

export async function invokeCreateDir(
  workspacePath: string,
  path: string,
): Promise<void> {
  return invoke("create_dir", { payload: { workspacePath, path } });
}

export async function invokeRename(
  workspacePath: string,
  oldPath: string,
  newName: string,
): Promise<void> {
  return invoke("rename_entry", {
    payload: { workspacePath, oldPath, newName },
  });
}

export async function invokeDelete(
  workspacePath: string,
  path: string,
  isDir: boolean,
): Promise<void> {
  return invoke("delete_entry", { payload: { workspacePath, path, isDir } });
}

export async function invokeMove(
  workspacePath: string,
  sourcePath: string,
  destinationDirPath: string,
): Promise<void> {
  return invoke("move_entry", {
    payload: { workspacePath, sourcePath, destinationDirPath },
  });
}

export async function invokeReveal(
  workspacePath: string,
  path: string,
): Promise<void> {
  return invoke("reveal_in_file_manager", {
    payload: { workspacePath, path },
  });
}
