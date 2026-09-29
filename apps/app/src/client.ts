import "./style.css";

const app = document.querySelector<HTMLDivElement>("#app");

if (app) {
  fetch("/api/health")
    .then((response) => response.json() as Promise<{ status: string }>)
    .then(({ status }) => {
      app.dataset.apiStatus = status;
    })
    .catch(() => {
      app.dataset.apiStatus = "unavailable";
    });
}
