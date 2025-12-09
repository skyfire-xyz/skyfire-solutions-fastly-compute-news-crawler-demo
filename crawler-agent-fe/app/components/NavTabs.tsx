"use client"

import { useRouter, usePathname } from "next/navigation"

const tabs = [
  { 
    label: "Crawl without Token", 
    route: "/",
  },
  { 
    label: "Crawl with Token", 
    route: "/token",
  },
  { 
    label: "Do It Yourself", 
    route: "/diy",
  },
]

const NavTabs: React.FC = () => {
  const router = useRouter()
  const pathname = usePathname()

  return (
    <div className="inline-flex rounded-lg bg-blue-10 p-1 shadow-sm border border-gray-200">
      {tabs.map((tab) => {
        const isActive = pathname === tab.route
        return (
          <button
            key={tab.route}
            className={`flex items-center gap-2 rounded-md px-6 py-2 font-medium transition-all duration-200 ${
              isActive
                ? "bg-white text-blue-600 shadow-sm"
                : "text-gray-600 hover:bg-gray-50 hover:text-gray-900"
            }`}
            onClick={() => router.push(tab.route)}
          >
            {tab.label}
          </button>
        )
      })}
    </div>
  )
}

export default NavTabs
