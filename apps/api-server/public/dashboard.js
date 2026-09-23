/*
 * Read-only operations console. All requests are relative to the page origin so
 * the browser never has to know the API host. The API key lives in
 * sessionStorage for the lifetime of the tab and is never written to a URL.
 */
(function () {
  'use strict';

  var REFRESH_MS = 5000;
  var KEY_STORAGE = 'fueltrack.apiKey';
  var timer = null;

  function element(id) {
    return document.getElementById(id);
  }

  function status(message, kind) {
    var node = element('connection-status');
    node.textContent = message;
    node.className = kind ? 'status ' + kind : 'status';
  }

  function escapeText(value) {
    return String(value === null || value === undefined ? '' : value).replace(
      /[&<>"']/g,
      function (char) {
        return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char];
      },
    );
  }

  function normalizeKey(raw) {
    var key = String(raw).trim();
    if (/^Bearer\s+/i.test(key)) {
      key = key.replace(/^Bearer\s+/i, '').trim();
    }
    if (
      (key.charAt(0) === '"' && key.charAt(key.length - 1) === '"') ||
      (key.charAt(0) === "'" && key.charAt(key.length - 1) === "'")
    ) {
      key = key.slice(1, -1).trim();
    }
    return key;
  }

  function readErrorBody(response) {
    return response.text().then(
      function (text) {
        try {
          var parsed = JSON.parse(text);
          return parsed && typeof parsed === 'object' ? parsed : {};
        } catch {
          return {};
        }
      },
      function () {
        return {};
      },
    );
  }

  function failure(message, kind) {
    var error = new Error(message);
    error.kind = kind;
    return error;
  }

  // Server error bodies carry a non-secret message (and, for a 403, the
  // missing scope). They are shown as text through textContent, never as HTML.
  function describeFailure(response, body, line) {
    var requestId = body.requestId ? ' Request id: ' + body.requestId + '.' : '';
    if (response.status === 401) {
      return failure(
        'The API key was rejected ' + line + '. It is unknown, revoked or expired.',
        'unauthorized',
      );
    }
    if (response.status === 403) {
      return failure(
        'Access denied. ' +
          (body.message || 'This key is not permitted to make this request.') +
          requestId +
          ' ' +
          line,
        'forbidden',
      );
    }
    return failure((body.message || 'Request failed') + requestId + ' ' + line, 'other');
  }

  function request(path, key) {
    var secret = normalizeKey(key);
    var method = 'GET';
    // Diagnostics name the method and URL path (never the query string, never
    // the key) so a failure can be matched against the server's route table.
    var pathOnly = path.split('?')[0] || path;
    return fetch(path, {
      method: method,
      headers: { authorization: 'Bearer ' + secret, accept: 'application/json' },
      cache: 'no-store',
    }).then(
      function (response) {
        if (response.ok) {
          return response.json();
        }
        var line = '[' + method + ' ' + pathOnly + ' status ' + response.status + ']';
        return readErrorBody(response).then(function (body) {
          throw describeFailure(response, body, line);
        });
      },
      function (error) {
        if (error && /Failed to fetch|NetworkError|Load failed/i.test(error.message || '')) {
          throw failure(
            'Unable to reach the API [' +
              method +
              ' ' +
              pathOnly +
              ' no response]. Check that the API is running and CORS is configured.',
            'network',
          );
        }
        throw error;
      },
    );
  }

  function renderTanks(tanks, latestByTank) {
    var body = element('tanks-body');
    if (tanks.length === 0) {
      body.innerHTML =
        '<tr><td colspan="8" class="empty">No tanks are registered for this tenant.</td></tr>';
      return;
    }

    body.innerHTML = tanks
      .map(function (tank) {
        var reading = latestByTank[tank.id];
        var percent =
          reading && tank.capacityLitres > 0
            ? (reading.netVolumeLitres / tank.capacityLitres) * 100
            : null;
        var percentText = percent === null ? 'no data' : percent.toFixed(1) + '%';
        var percentValue = percent === null ? 0 : Math.max(0, Math.min(100, percent));
        return [
          '<tr>',
          '<td>' + escapeText(tank.name) + '</td>',
          '<td>' + escapeText(tank.product) + '</td>',
          '<td class="numeric">' + (reading ? reading.levelMm.toFixed(0) + ' mm' : '-') + '</td>',
          '<td class="numeric">' +
            (reading ? reading.netVolumeLitres.toFixed(0) + ' L' : '-') +
            '</td>',
          '<td><progress max="100" value="' +
            percentValue.toFixed(1) +
            '"></progress> ' +
            percentText +
            '</td>',
          '<td class="numeric">' +
            (reading && reading.temperatureC !== null
              ? reading.temperatureC.toFixed(1) + ' C'
              : '-') +
            '</td>',
          '<td class="numeric">' +
            (reading ? reading.waterLevelMm.toFixed(1) + ' mm' : '-') +
            '</td>',
          '<td class="numeric">' + (reading ? escapeText(reading.recordedAt) : '-') + '</td>',
          '</tr>',
        ].join('');
      })
      .join('');
  }

  function renderAlerts(alerts) {
    var list = element('alert-list');
    if (alerts.length === 0) {
      list.innerHTML = '<li class="empty">No open alerts.</li>';
      return;
    }
    list.innerHTML = alerts
      .map(function (alert) {
        return [
          '<li>',
          '<span class="tag ' +
            escapeText(alert.severity) +
            '">' +
            escapeText(alert.severity) +
            '</span>',
          '<strong>' + escapeText(alert.type) + '</strong>',
          '<span>' + escapeText(alert.message) + '</span>',
          '<span class="when">' + escapeText(alert.raisedAt) + '</span>',
          '</li>',
        ].join('');
      })
      .join('');
  }

  function renderAlertsError(message) {
    var list = element('alert-list');
    list.innerHTML = '';
    var item = document.createElement('li');
    item.className = 'empty error';
    item.textContent = message;
    list.appendChild(item);
  }

  function refresh(key) {
    var tanksPromise = request('/v1/tanks?limit=50', key);
    // Alerts are loaded independently: a key that may read tanks but not
    // alerts (403) still gets a working tank table and a precise alert error.
    var alertsPromise = request('/v1/alerts?status=open&limit=50', key).then(
      function (payload) {
        return { alerts: payload.alerts || [], error: null };
      },
      function (error) {
        return { alerts: null, error: error };
      },
    );

    return Promise.all([tanksPromise, alertsPromise])
      .then(function (results) {
        var tanks = results[0].tanks || [];
        var alertsResult = results[1];
        if (alertsResult.error && alertsResult.error.kind === 'unauthorized') {
          throw alertsResult.error;
        }
        return Promise.all(
          tanks.map(function (tank) {
            return request(
              '/v1/tanks/' + encodeURIComponent(tank.id) + '/readings?limit=1',
              key,
            ).then(
              function (payload) {
                return { tankId: tank.id, reading: (payload.readings || [])[0] || null };
              },
              function () {
                return { tankId: tank.id, reading: null };
              },
            );
          }),
        ).then(function (latest) {
          var latestByTank = {};
          latest.forEach(function (entry) {
            if (entry.reading) {
              latestByTank[entry.tankId] = entry.reading;
            }
          });
          renderTanks(tanks, latestByTank);
          var time = new Date().toLocaleTimeString();
          if (alertsResult.error) {
            renderAlertsError(alertsResult.error.message);
            status('Connected with limited access. Last update ' + time, 'warning');
          } else {
            renderAlerts(alertsResult.alerts);
            status('Connected. Last update ' + time, 'ready');
          }
        });
      })
      .catch(function (error) {
        if (error && error.kind === 'unauthorized') {
          // The same key cannot start working by itself; stop polling it.
          stop();
          window.sessionStorage.removeItem(KEY_STORAGE);
        }
        status(error.message || 'Unable to load data', 'error');
      });
  }

  function stop() {
    if (timer !== null) {
      window.clearInterval(timer);
      timer = null;
    }
  }

  function start(key) {
    stop();
    refresh(key);
    timer = window.setInterval(function () {
      refresh(key);
    }, REFRESH_MS);
  }

  element('credentials-form').addEventListener('submit', function (event) {
    event.preventDefault();
    var key = normalizeKey(element('api-key').value);
    if (key.length === 0) {
      status('Enter an API key first', 'error');
      return;
    }
    window.sessionStorage.setItem(KEY_STORAGE, key);
    start(key);
  });

  element('disconnect').addEventListener('click', function () {
    stop();
    window.sessionStorage.removeItem(KEY_STORAGE);
    element('api-key').value = '';
    element('tanks-body').innerHTML = '<tr><td colspan="8" class="empty">No data loaded.</td></tr>';
    element('alert-list').innerHTML = '<li class="empty">No data loaded.</li>';
    status('Disconnected');
  });

  var remembered = window.sessionStorage.getItem(KEY_STORAGE);
  if (remembered) {
    remembered = normalizeKey(remembered);
    window.sessionStorage.setItem(KEY_STORAGE, remembered);
    element('api-key').value = remembered;
    start(remembered);
  }
})();
