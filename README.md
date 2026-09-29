# PriceCompare

Fetches ESDS **Compute Virtual CPU** and **Compute Virtual RAM** rates from
https://www.esds.co.in/cloud-service-rates once a day and shows them on a simple page.
Python 3 standard library only — no `pip install` needed.

## Run
    python3 app.py            # http://<vm-ip>:8000  (API: /api/rates)
    PORT=80 python3 app.py    # custom port (80 needs root)

## Run as a service on a VM (systemd)
    sudo git clone https://github.com/mehrshadnava/PriceCompare /opt/PriceCompare
    sudo chown -R www-data /opt/PriceCompare
    sudo cp /opt/PriceCompare/pricecompare.service /etc/systemd/system/
    sudo systemctl enable --now pricecompare

Open port 8000 in the VM firewall / security group. The latest data is cached in `rates.json`.
