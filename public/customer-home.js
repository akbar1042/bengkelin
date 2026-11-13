for (const button of document.querySelectorAll("[data-landing-logout]")) {
  button.addEventListener("click", async () => {
    button.disabled = true;
    try {
      await Bengkel.request("/api/logout", Bengkel.json("POST", {}));
      location.replace("/");
    } catch (error) {
      document.getElementById("landingAuthStatus").textContent = error.message;
      button.disabled = false;
    }
  });
}
