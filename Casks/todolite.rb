cask "todolite" do
  arch arm: "aarch64", intel: "x64"

  version "0.1.0"
  sha256 arm:   "95a398fe34421057692d6ff627137db9408471d68e1b3d92c2130231196ebc54",
         intel: "dfd60f7c39726aee6cfcafb63bfee258d123990d29f4a21e160a7fe85bf9cc05"

  url "https://github.com/oroiteS/todo/releases/download/v#{version}/TodoLite_#{version}_#{arch}.dmg"
  name "TodoLite"
  desc "Lightweight and beautiful cross-platform todo list"
  homepage "https://github.com/oroiteS/todo"

  depends_on :macos

  livecheck do
    url :url
    strategy :github_latest
  end

  app "TodoLite.app"

  zap trash: [
    "~/Library/Application Support/com.syn.todolite",
    "~/Library/Caches/com.syn.todolite",
    "~/Library/Preferences/com.syn.todolite.plist",
    "~/Library/Saved Application State/com.syn.todolite.savedState",
    "~/Library/WebKit/com.syn.todolite",
  ]
end
