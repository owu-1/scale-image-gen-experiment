MINICONDA3_PYTHON_MAJOR_VERSION="3"
MINICONDA3_PYTHON_MINOR_VERSION="11" # Cannot build old version of numpy on 3.12
MINICONDA3_VERSION="24.4.0-0"
MINICONDA3_INSTALLER_FILE_NAME="Miniconda3-py${MINICONDA3_PYTHON_MAJOR_VERSION}${MINICONDA3_PYTHON_MINOR_VERSION}_${MINICONDA3_VERSION}-Linux-x86_64.sh"
MINICONDA3_DOWNLOAD_URL="https://repo.anaconda.com/miniconda/${MINICONDA3_INSTALLER_FILE_NAME}"

BUILD_DIR="/home/ubuntu"

# This script assumes you are running a inf2.xlarge instance
# Warnings:
# - apt requires interaction to continue. "Daemons using outdated libraries" interaction
# - Must add "/swapfile none  swap  defaults  0 0" to /etc/fstab to auto mount swap on reboot
# - Use 50GB to safely store libraries, model and model cache (which is generated on first model load)
# - Should run main.py once before snapshoting disk to capture the neuron cache (I have no idea where it is stored)

download () {
    local save_path=$1
    local url=$2
    curl -fsSL -o "${save_path}" "${url}"
}

# Install Miniconda3
download "./${MINICONDA3_INSTALLER_FILE_NAME}" "${MINICONDA3_DOWNLOAD_URL}"
bash "./${MINICONDA3_INSTALLER_FILE_NAME}" -b -u -p ./miniconda3

# Setup Miniconda3
./miniconda3/bin/conda init bash
eval "$(./miniconda3/bin/conda shell.bash hook)"
conda create -y -n build python="${MINICONDA3_PYTHON_MAJOR_VERSION}.${MINICONDA3_PYTHON_MINOR_VERSION}"
conda activate build

# Configure Linux for Neuron repository updates
. /etc/os-release
sudo tee /etc/apt/sources.list.d/neuron.list > /dev/null <<EOF
deb https://apt.repos.neuron.amazonaws.com ${VERSION_CODENAME} main
EOF
wget -qO - https://apt.repos.neuron.amazonaws.com/GPG-PUB-KEY-AMAZON-AWS-NEURON.PUB | sudo apt-key add -

# Update package info
sudo apt-get update -y

# Install Neuron driver, runtime, and tools
sudo apt-get install \
  aws-neuronx-dkms=2.* \
  aws-neuronx-collectives=2.* \
  aws-neuronx-runtime-lib=2.* \
  aws-neuronx-tools=2.* -y

# Install Optimum Neuron
pip config set global.extra-index-url https://pip.repos.neuron.amazonaws.com
pip install --upgrade --upgrade-strategy eager optimum[neuronx]
pip install diffusers
pip install setuptools==69.5.1 # https://github.com/aws-neuron/aws-neuron-sdk/issues/893

# Create swap file (8 GB)
sudo dd if=/dev/zero of=/swapfile bs=128M count=64
sudo chmod 600 /swapfile
sudo mkswap /swapfile
# sudo swapon /swapfile # Only uncomment if you want to activate the swap. Swap will not be activated on boot if just this is used

# Fixes python header files error
echo -e "export LD_LIBRARY_PATH=${BUILD_DIR}/miniconda3/envs/build/lib" >> ~/.bashrc

# Optional
# pip install notebook
# sudo apt install awscli
