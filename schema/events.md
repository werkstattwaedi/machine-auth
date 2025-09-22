# Cloud Events

## Cloud Request

TODO: maybe refactor method and request id into path?

path: "terminalRequest"
Payload: {"id":"$requestId","method":"$endpoint","data":"base64 serialized flatbuffer"}

0a10aced202194944a042f04/hook-response/terminalRequest/0
Payload: {
"id":"$requestId"
"data":"base64 serialized flatbuffer"
}

## Sessions

These are events send from the cloud to all devices

### New Session Created

Path: "/sessions/new"
Payload: TokenSession

### End Machine Usage for User

Request to end all current machine usage for the user.
Terminals must call flush all local usage with UploadUsage.

Path: "/sessions/close/{userId}"
Payload: -
