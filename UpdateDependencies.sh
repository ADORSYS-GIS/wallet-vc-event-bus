#!/bin/bash

# Function to check if a command exists
check_command() {
    command -v "$1" >/dev/null 2>&1 || missing_tools+=("$1")
}

# Function to install ESLint packages if needed
install_eslint_packages() {
    echo "Installing required ESLint packages..."
    npm install @eslint/js @eslint/eslintrc -D || {
        echo "Failed to install ESLint packages.";
        exit 1;
    }
}

# Function to update dependencies in a package
update_dependencies() {
    local package_path="$1"
    echo "Updating dependencies in $package_path..."

    # Navigate to the package directory and update all dependencies
    (
        cd "$package_path" &&
        npx npm-check-updates -u &&
        npm install
    ) || {
        echo "Failed to update dependencies or fix vulnerabilities in $package_path";
        exit 1;
    }
    echo "Dependencies and vulnerabilities updated successfully in $package_path."
}

# Function to update ESLint configuration
update_eslint_config() {
    local package_path="$1"
    local eslint_config_path="$package_path/.eslintrc.json"
    if [ -f "$eslint_config_path" ]; then
        echo "Backing up existing .eslintrc.json..."
        cp "$eslint_config_path" "$eslint_config_path.bak" || {
            echo "Failed to backup $eslint_config_path";
            exit 1;
        }
        echo "Migrating ESLint config in $eslint_config_path..."
        (cd "$package_path" && npx @eslint/migrate-config .eslintrc.json) || {
            echo "ESLint migration failed in $package_path";
            exit 1;
        }
        echo "ESLint config migration completed. Please review the generated eslint.config.mjs file."
    fi
}

# Main function to update all packages
update_all_packages() {
    local packages_dir="./packages"

    # Confirm before starting updates
    read -p "Are you sure you want to update all packages and fix vulnerabilities? (yes/no): " confirm
    if [[ "$confirm" != "yes" ]]; then
        echo "Update canceled by user."
        exit 0
    fi

    # Update dependencies for each package
    for pkg in "$packages_dir"/*; do
        if [ -d "$pkg" ]; then
            update_dependencies "$pkg"
            update_eslint_config "$pkg"
        fi
    done

    # Ask if root package update should be skipped
    read -p "Do you want to update the root package.json as well? (yes/no): " update_root
    if [[ "$update_root" == "yes" ]]; then
        echo "Updating root package dependencies..."
        npx npm-check-updates -u &&
        npm install
        echo "Root package dependencies and vulnerabilities updated successfully."
    else
        echo "Skipped root package update."
    fi

    # Install required ESLint packages
    install_eslint_packages
}

# Run the update
update_all_packages

# Run additional commands
echo "Running additional commands..."
npm run lint || { echo "Linting failed"; exit 1; }
npm run format -- --fix || { echo "Formatting failed"; exit 1; }
npm run build || { echo "Build failed"; exit 1; }
npm run test || { echo "Tests failed"; exit 1; }

echo "All tasks completed successfully!"