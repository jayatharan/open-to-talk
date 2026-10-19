// Vite resolves imported image files to their URL.
declare module "*.svg" {
  const src: string;
  export default src;
}
