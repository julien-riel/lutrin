/**
 * `node:os`, for the browser playground.
 *
 * Everything the compiler asks `os` for is a path it will then fail to read:
 * the user config root (`~/.config/lutrin`), the icon cache, a temp directory
 * for Mermaid. Returning plausible-looking paths rather than throwing is
 * deliberate — the call sites are guarded against a failed *read*, not against
 * a missing `os`, and a throw here would take down module instantiation
 * instead of degrading one feature.
 */
export const homedir = () => '/home/playground';
export const tmpdir = () => '/tmp';
export const hostname = () => 'playground';
export const platform = () => 'browser';
export const userInfo = () => ({ username: 'playground', homedir: homedir() });
export const EOL = '\n';

export default { homedir, tmpdir, hostname, platform, userInfo, EOL };
