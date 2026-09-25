"""Dependency-free server-side Python tracing. Store credentials in environment variables."""
import contextvars
import datetime
import json
import os
import sys
import urllib.request
import uuid
from contextlib import contextmanager
_parent = contextvars.ContextVar('workbench_parent', default=None)
def _now():
    return datetime.datetime.now(datetime.timezone.utc).isoformat()
def _bounded(value):
    try:
        raw = json.dumps(value, default=str)
        return raw[:19950] + ' [truncated]' if len(raw) > 20000 else json.loads(raw)
    except Exception:
        return '[not JSON serializable]'
class WorkbenchTrace:
    def __init__(self, name, input=None, url=None, token=None):
        self.name, self.input = name, _bounded(input)
        self.url, self.token = url or os.environ.get('WORKBENCH_URL'), token or os.environ.get('WORKBENCH_TOKEN')
        self.trace_id = str(uuid.uuid4())
        if not self.url or not self.token:
            raise ValueError('Set server-side WORKBENCH_URL and WORKBENCH_TOKEN')
    def _send(self, span, status=None, output=None):
        body = dict(traceId=self.trace_id, name=self.name, input=self.input, spans=[span])
        if status: body['status'] = status
        if output is not None: body['output'] = _bounded(output)
        try:
            req = urllib.request.Request(self.url, data=json.dumps(body).encode(), headers={'Content-Type':'application/json', 'Authorization':'Bearer '+self.token}, method='POST')
            with urllib.request.urlopen(req, timeout=3): pass
        except Exception:
            print('[Workbench] Trace delivery unavailable; application execution continues.', file=sys.stderr)
    @contextmanager
    def span(self, name, role='tool', input=None, node_id=None, source=None, model=None, _root=False):
        span = dict(id=str(uuid.uuid4()), name=name, role=role, input=_bounded(input), status='running', startTime=_now())
        for key, value in [('parentId', _parent.get()), ('nodeId', node_id), ('source', source), ('model', model)]:
            if value is not None: span[key] = value
        self._send(span, 'running' if _root else None)
        token = _parent.set(span['id'])
        result = {'output': None}
        try:
            yield result
            span.update(status='completed', endTime=_now(), output=_bounded(result['output']))
            self._send(span, 'completed' if _root else None, result['output'] if _root else None)
        except Exception as error:
            span.update(status='failed', endTime=_now(), error=str(error)[:20000])
            self._send(span, 'failed' if _root else None)
            raise
        finally:
            _parent.reset(token)
    def run(self):
        return self.span(self.name, role='orchestrator', input=self.input, _root=True)
