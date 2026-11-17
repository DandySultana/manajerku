import React from "react";

export default function DashboardRouteLoading() {
  return (
    <div
      className="space-y-6 animate-pulse"
      role="status"
      aria-busy="true"
      aria-label="Memuat halaman..."
    >
      {/* Page Header Skeleton */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div className="space-y-2">
          <div className="h-7 w-64 sm:w-80 rounded-lg bg-[#E2E8F0]" />
          <div className="h-4 w-72 sm:w-96 rounded-md bg-[#F1F5F9]" />
        </div>
        <div className="flex items-center gap-2.5">
          <div className="h-10 w-36 rounded-xl bg-[#E2E8F0]" />
          <div className="h-10 w-40 rounded-xl bg-[#D7F0E6]/70" />
        </div>
      </div>

      {/* 4 KPI Summary Cards Skeleton */}
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
        {[1, 2, 3, 4].map((idx) => (
          <div
            key={idx}
            className="min-h-[138px] rounded-2xl bg-white border border-[#E5E9EC] p-5 shadow-[0_1px_2px_rgba(15,23,42,0.03)] flex flex-col justify-between"
          >
            <div className="flex items-center justify-between gap-2">
              <div className="h-3.5 w-32 rounded bg-[#E2E8F0]" />
              <div className="h-5 w-16 rounded-full bg-[#F1F5F9]" />
            </div>
            <div className="my-2 space-y-2">
              <div className="h-7 w-40 rounded-lg bg-[#CBD5E1]" />
            </div>
            <div className="h-3 w-36 rounded bg-[#F1F5F9]" />
          </div>
        ))}
      </div>

      {/* Main 12-Column Split Content Skeleton */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-5 items-stretch">
        <div className="lg:col-span-7 rounded-2xl bg-white border border-[#E5E9EC] p-5 shadow-[0_1px_2px_rgba(15,23,42,0.03)] space-y-4">
          <div className="flex items-center justify-between gap-3">
            <div className="space-y-1.5">
              <div className="h-4 w-48 rounded bg-[#E2E8F0]" />
              <div className="h-3 w-64 rounded bg-[#F1F5F9]" />
            </div>
            <div className="h-8 w-28 rounded-lg bg-[#F1F5F9]" />
          </div>
          <div className="h-56 w-full rounded-xl bg-[#F8FAFC] border border-[#F1F5F9] p-4 flex items-end justify-between gap-3">
            {[48, 72, 60, 88, 65, 92, 78].map((pct, i) => (
              <div
                key={i}
                style={{ height: `${pct}%` }}
                className="flex-1 rounded-t-lg bg-[#E2E8F0]"
              />
            ))}
          </div>
        </div>

        <div className="lg:col-span-5 rounded-2xl bg-white border border-[#E5E9EC] p-5 shadow-[0_1px_2px_rgba(15,23,42,0.03)] space-y-4">
          <div className="space-y-1.5">
            <div className="h-4 w-44 rounded bg-[#E2E8F0]" />
            <div className="h-3 w-56 rounded bg-[#F1F5F9]" />
          </div>
          <div className="space-y-3 pt-1">
            {[1, 2, 3].map((row) => (
              <div
                key={row}
                className="rounded-xl bg-[#F8FAFC] border border-[#E5E9EC] p-3.5 flex items-center justify-between gap-3"
              >
                <div className="space-y-1.5 flex-1">
                  <div className="h-3.5 w-3/4 rounded bg-[#E2E8F0]" />
                  <div className="h-3 w-1/2 rounded bg-[#F1F5F9]" />
                </div>
                <div className="h-8 w-20 rounded-lg bg-[#E2E8F0] shrink-0" />
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Bottom Table Section Skeleton */}
      <div className="rounded-2xl bg-white border border-[#E5E9EC] p-5 shadow-[0_1px_2px_rgba(15,23,42,0.03)] space-y-4">
        <div className="flex items-center justify-between gap-3">
          <div className="h-4 w-52 rounded bg-[#E2E8F0]" />
          <div className="h-8 w-40 rounded-lg bg-[#F1F5F9]" />
        </div>
        <div className="space-y-2.5">
          {[1, 2, 3, 4].map((r) => (
            <div
              key={r}
              className="h-12 w-full rounded-xl bg-[#F8FAFC] border border-[#F1F5F9] px-4 flex items-center justify-between gap-4"
            >
              <div className="h-3.5 w-44 rounded bg-[#E2E8F0]" />
              <div className="h-3.5 w-28 rounded bg-[#F1F5F9] hidden sm:block" />
              <div className="h-3.5 w-24 rounded bg-[#E2E8F0]" />
              <div className="h-6 w-20 rounded-full bg-[#F1F5F9]" />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
