import { useEffect, useState } from "react";
import Header from "./components/Header.jsx";
import { CoinProvider } from "./hooks/useCoins.jsx";
import { WalletProvider } from "./hooks/useWallet.jsx";
import Arena from "./pages/Arena.jsx";
import Collection from "./pages/Collection.jsx";
import Forge from "./pages/Forge.jsx";
import History from "./pages/History.jsx";
import Home from "./pages/Home.jsx";
import Odds from "./pages/Odds.jsx";
import Shop from "./pages/Shop.jsx";
import TopUp from "./pages/TopUp.jsx";

const PAGES = [
  { id: "home", label: "Home", component: Home },
  { id: "topup", label: "Top Up", component: TopUp },
  { id: "shop", label: "Shop", component: Shop },
  { id: "collection", label: "My Cards", component: Collection },
  { id: "forge", label: "Forge", component: Forge },
  { id: "arena", label: "Arena", component: Arena },
  { id: "history", label: "History", component: History },
  { id: "odds", label: "Rules", component: Odds },
];

// The current page lives in the URL hash (#shop) so a refresh keeps it.
function pageFromHash() {
  const id = window.location.hash.slice(1);
  return PAGES.some((page) => page.id === id) ? id : "home";
}

export default function App() {
  const [pageId, setPageId] = useState(pageFromHash);

  useEffect(() => {
    window.location.hash = pageId;
    const onHashChange = () => setPageId(pageFromHash());
    window.addEventListener("hashchange", onHashChange);
    return () => window.removeEventListener("hashchange", onHashChange);
  }, [pageId]);

  const Page = PAGES.find((page) => page.id === pageId).component;

  return (
    <WalletProvider>
      <CoinProvider>
        <Header pages={PAGES} current={pageId} onNavigate={setPageId} />
        <main className="page">
          <Page onNavigate={setPageId} />
        </main>
      </CoinProvider>
    </WalletProvider>
  );
}
