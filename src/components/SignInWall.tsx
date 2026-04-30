"use client";

export default function SignInWall({
  reason,
  onSignInClick,
}: {
  reason?: "query_limit" | "solution_tier";
  onSignInClick: () => void;
}) {
  const isSolution = reason === "solution_tier";

  return (
    <div className="my-4 mx-auto max-w-md bg-[#1a1a24] border border-red-500/20 rounded-2xl px-5 py-5 text-center">
      <div className="text-2xl mb-2">{isSolution ? "💡" : "🔒"}</div>
      <p className="text-sm font-semibold text-gray-100 mb-1">
        {isSolution
          ? "Sign in to use Solution mode"
          : "You've used your 2 free questions"}
      </p>
      <p className="text-xs text-gray-400 mb-4">
        {isSolution
          ? "Solution mode gives you full strategies, exact locations, and step-by-step answers. Free to sign up."
          : "Sign in for 5 questions a day and fewer ads. No credit card needed."}
      </p>
      <button
        onClick={onSignInClick}
        className="inline-block bg-red-600 hover:bg-red-700 text-white text-sm font-medium rounded-xl px-6 py-2 transition-colors"
      >
        Sign in / Create free account
      </button>
    </div>
  );
}
