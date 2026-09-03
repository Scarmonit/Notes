import { app } from 'electron';
import { createHistory } from '../core/history';

/** The app's history, beside its notes. The rules live in core/history.ts. */
export const history = createHistory(app.getPath('userData'));

export const historyDir = (): string => history.dir;
export const { keepNow, record, forgetHistory, listHistory, getSnapshot } = history;
