import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    background_color: "#08111f",
    description:
      "Local-first premium control surface for Zapp smart switch rooms, provisioning, and LLM automation.",
    display: "standalone",
    icons: [
      {
        sizes: "512x512",
        src: "/icons/zapp-icon.svg",
        type: "image/svg+xml",
      },
      {
        purpose: "maskable",
        sizes: "512x512",
        src: "/icons/zapp-maskable.svg",
        type: "image/svg+xml",
      },
    ],
    name: "Zapp",
    orientation: "portrait",
    short_name: "Zapp",
    start_url: "/",
    theme_color: "#0b1324",
  };
}
