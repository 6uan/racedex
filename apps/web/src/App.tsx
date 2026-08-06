import { APP_NAME } from "@racedex/shared";

export default function App() {
  return (
    <main className="mx-auto max-w-2xl p-8">
      <h1 className="text-3xl font-bold">{APP_NAME}</h1>
      <p className="mt-2 text-gray-600">
        A race directory for South Florida runners.
      </p>
    </main>
  );
}
