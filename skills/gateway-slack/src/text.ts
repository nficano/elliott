const THREAD_TITLE_CHARACTERS = 80;
const TASK_TEXT_CHARACTERS = 256;

export const threadTitle = (text: string): string => {
  const firstLine = text.split("\n", 1)[0]?.trim() ?? "";
  return (firstLine || "New conversation").slice(0, THREAD_TITLE_CHARACTERS);
};

export const taskTitle = (name: string): string =>
  name.replaceAll(/[_-]/g, " ").slice(0, TASK_TEXT_CHARACTERS);
