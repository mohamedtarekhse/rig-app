export function ok(response, data, status = 200) {
    return response.status(status).json({ success: true, data });
}
export function fail(response, status, error) {
    return response.status(status).json({ success: false, error });
}
