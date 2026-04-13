import { fail } from '../utils/http.js';
import { verifyToken } from '../utils/auth.js';
export function requireAuth(request, response, next) {
    const header = request.headers.authorization;
    if (!header?.startsWith('Bearer ')) {
        return fail(response, 401, 'Unauthorized');
    }
    try {
        request.user = verifyToken(header.slice(7));
        return next();
    }
    catch {
        return fail(response, 401, 'Unauthorized');
    }
}
