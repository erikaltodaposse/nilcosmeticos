// Funções puras do congelamento do checklist (brief, seção 7.2). Nada aqui toca banco ou Express.

export const FOCUS_PLACEHOLDER = '{foco}';

/** Postagem congelada no dia: o roteiro pode mudar depois sem alterar o que já foi registrado. */
export function snapshotPost(post) {
  return {
    id: post.id,
    time: post.time ?? null,
    kind: post.kind ?? null,
    goal: post.goal ?? null,
    image_prompt: post.image_prompt ?? null,
    text_prompt: post.text_prompt ?? null,
  };
}

/**
 * Cópia profunda do template vigente, já com o foco de limpeza aplicado.
 * `template` = { version_id, weekday, cleaning_focus, sections: [{ title, subtitle, tasks: [...] }] }.
 * `posts` = roteiro da data, que entra na tarefa de postagens.
 */
export function buildSnapshot(template, posts = []) {
  const focus = template.cleaning_focus ?? '';
  return {
    version_id: template.version_id ?? null,
    weekday: template.weekday,
    cleaning_focus: focus,
    sections: template.sections.map((section) => ({
      title: section.title,
      subtitle: section.subtitle ?? null,
      tasks: section.tasks.map((task) => ({
        id: task.id,
        text: String(task.text).replaceAll(FOCUS_PLACEHOLDER, focus),
        // Texto original, com {foco}: identifica a mesma tarefa em dias com focos diferentes.
        template_text: String(task.text),
        points: Number(task.points),
        requires_photo: Boolean(task.requires_photo),
        auto: task.auto ?? null,
        due_time: task.due_time ?? null,
        ...(task.posts ? { posts: posts.map(snapshotPost) } : {}),
      })),
    })),
  };
}

export function snapshotTasks(snapshot) {
  return snapshot.sections.flatMap((section) => section.tasks);
}

export function findSnapshotTask(snapshot, taskId) {
  return snapshotTasks(snapshot).find((task) => task.id === taskId) ?? null;
}

/** A tarefa de postagens do dia, se houver. */
export function postsTask(snapshot) {
  return snapshotTasks(snapshot).find((task) => Array.isArray(task.posts)) ?? null;
}

/** Tarefa marcada pelas postagens, uma a uma (e não pelo toque na própria tarefa). */
export function isPostsDriven(task) {
  return Array.isArray(task?.posts) && task.posts.length > 0;
}

/** Dia sem check-in, sem check-out e sem nenhuma tarefa marcada. */
export function isDayEmpty(day, checks, postChecks = []) {
  return !day.check_in_at && !day.check_out_at && checks.length === 0 && postChecks.length === 0;
}

/** Só o dia de hoje, ainda vazio, pode ter o snapshot regravado após uma edição do checklist. */
export function canRewriteSnapshot(day, checks, today, postChecks = []) {
  return day.date === today && isDayEmpty(day, checks, postChecks);
}
